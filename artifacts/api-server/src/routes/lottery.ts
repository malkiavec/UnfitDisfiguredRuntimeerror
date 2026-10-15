import { Router, type IRouter } from "express";
import { GetLotteryAnalysisResponse } from "@workspace/api-zod";

const router: IRouter = Router();
const API_URL = "https://data.ny.gov/resource/6nbc-h7bj.json";
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_NUMBER = 59;
const DRAW_SIZE = 6;

type RawEntry = {
  draw_date?: string;
  winning_numbers?: string;
};

type Draw = {
  drawDate: string;
  numbers: number[];
  sum: number;
  oddCount: number;
  consecutivePairs: number;
};

let cached: { expiresAt: number; payload: ReturnType<typeof buildAnalysis> } | null = null;

function consecutivePairs(numbers: number[]) {
  return numbers.reduce((count, number, index) => {
    return index > 0 && number === numbers[index - 1] + 1 ? count + 1 : count;
  }, 0);
}

function parseDraws(entries: RawEntry[]): Draw[] {
  return entries
    .map((entry) => {
      const numbers = (entry.winning_numbers ?? "")
        .split(/\s+/)
        .map(Number)
        .filter((number) => Number.isInteger(number) && number > 0 && number <= MAX_NUMBER);
      if (!entry.draw_date || numbers.length < DRAW_SIZE) return null;
      const sorted = numbers.slice(0, DRAW_SIZE).sort((a, b) => a - b);
      return {
        drawDate: entry.draw_date,
        numbers: sorted,
        sum: sorted.reduce((total, number) => total + number, 0),
        oddCount: sorted.filter((number) => number % 2 === 1).length,
        consecutivePairs: consecutivePairs(sorted),
      };
    })
    .filter((draw): draw is Draw => Boolean(draw))
    .sort((a, b) => a.drawDate.localeCompare(b.drawDate));
}

type FeatureRow = { features: number[]; target: number };
type LogisticModel = { means: number[]; scales: number[]; weights: number[]; bias: number };
type Context = { total: number; all: number[]; recent20: number[]; recent100: number[]; lastSeen: number[] };

const FEATURE_COUNT = 5;
const MIN_HISTORY = 20;

function createContext(draws: Draw[], throughIndex: number): Context {
  const context: Context = {
    total: 0,
    all: Array(MAX_NUMBER + 1).fill(0),
    recent20: Array(MAX_NUMBER + 1).fill(0),
    recent100: Array(MAX_NUMBER + 1).fill(0),
    lastSeen: Array(MAX_NUMBER + 1).fill(-1),
  };
  for (let index = 0; index < throughIndex; index += 1) addDraw(context, draws[index], index);
  return context;
}

function addDraw(context: Context, draw: Draw, drawIndex: number) {
  context.total += 1;
  draw.numbers.forEach((number) => {
    context.all[number] += 1;
    context.recent20[number] += 1;
    context.recent100[number] += 1;
    context.lastSeen[number] = drawIndex;
  });
  if (context.total > 20) {
    drawsForRemoval(context, drawIndex - 20, drawIndex, 20);
  }
  if (context.total > 100) {
    drawsForRemoval(context, drawIndex - 100, drawIndex, 100);
  }
}

function drawsForRemoval(context: Context, removeIndex: number, currentIndex: number, window: number) {
  // The caller has already incremented the context. Window membership is based
  // on draw indexes, so stale counts are removed as the walk-forward advances.
  const target = window === 20 ? context.recent20 : context.recent100;
  if (removeIndex < 0 || currentIndex - removeIndex < window) return;
  const removedDraw = currentDrawsForContext.get(removeIndex);
  removedDraw?.numbers.forEach((number) => { target[number] = Math.max(0, target[number] - 1); });
}

const currentDrawsForContext = new Map<number, Draw>();

function getFeatures(context: Context, number: number) {
  const gap = context.lastSeen[number] < 0 ? 1 : Math.min(100, context.total - 1 - context.lastSeen[number]) / 100;
  return [
    context.all[number] / Math.max(1, context.total),
    context.recent20[number] / Math.max(1, Math.min(20, context.total)),
    context.recent100[number] / Math.max(1, Math.min(100, context.total)),
    gap,
    context.lastSeen[number] === context.total - 1 ? 1 : 0,
  ];
}

function makeTrainingRows(draws: Draw[], endIndex: number): FeatureRow[] {
  const context = createContext(draws, MIN_HISTORY);
  for (let index = 0; index < MIN_HISTORY; index += 1) currentDrawsForContext.set(index, draws[index]);
  const rows: FeatureRow[] = [];
  for (let targetIndex = MIN_HISTORY; targetIndex < endIndex; targetIndex += 1) {
    for (let number = 1; number <= MAX_NUMBER; number += 1) {
      rows.push({
        features: getFeatures(context, number),
        target: draws[targetIndex].numbers.includes(number) ? 1 : 0,
      });
    }
    currentDrawsForContext.set(targetIndex, draws[targetIndex]);
    addDraw(context, draws[targetIndex], targetIndex);
  }
  return rows;
}

function sigmoid(value: number) {
  if (value > 30) return 1;
  if (value < -30) return 0;
  return 1 / (1 + Math.exp(-value));
}

function trainLogisticModel(rows: FeatureRow[]): LogisticModel {
  const means = Array(FEATURE_COUNT).fill(0);
  const scales = Array(FEATURE_COUNT).fill(0);
  for (const row of rows) row.features.forEach((value, index) => { means[index] += value; });
  means.forEach((_, index) => { means[index] /= Math.max(1, rows.length); });
  for (const row of rows) row.features.forEach((value, index) => { scales[index] += (value - means[index]) ** 2; });
  scales.forEach((value, index) => { scales[index] = Math.sqrt(value / Math.max(1, rows.length)) || 1; });

  const weights = Array(FEATURE_COUNT).fill(0);
  const prevalence = rows.reduce((sum, row) => sum + row.target, 0) / Math.max(1, rows.length);
  let bias = Math.log(prevalence / (1 - prevalence));
  const learningRate = 0.18;
  const regularization = 0.015;
  const epochs = 80;
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const gradients = Array(FEATURE_COUNT).fill(0);
    let biasGradient = 0;
    for (const row of rows) {
      let value = bias;
      for (let feature = 0; feature < FEATURE_COUNT; feature += 1) {
        value += weights[feature] * ((row.features[feature] - means[feature]) / scales[feature]);
      }
      const error = sigmoid(value) - row.target;
      biasGradient += error;
      for (let feature = 0; feature < FEATURE_COUNT; feature += 1) {
        gradients[feature] += error * ((row.features[feature] - means[feature]) / scales[feature]);
      }
    }
    const denominator = Math.max(1, rows.length);
    bias -= learningRate * (biasGradient / denominator);
    for (let feature = 0; feature < FEATURE_COUNT; feature += 1) {
      weights[feature] -= learningRate * (gradients[feature] / denominator + regularization * weights[feature]);
    }
  }
  return { means, scales, weights, bias };
}

function predictLogistic(model: LogisticModel, context: Context) {
  return Array.from({ length: MAX_NUMBER }, (_, index) => {
    const features = getFeatures(context, index + 1);
    const logit = features.reduce((sum, value, feature) => {
      return sum + model.weights[feature] * ((value - model.means[feature]) / model.scales[feature]);
    }, model.bias);
    return { number: index + 1, score: sigmoid(logit) };
  }).sort((a, b) => b.score - a.score || a.number - b.number);
}

function scoreNumbers(draws: Draw[], recencyWeight: number) {
  const scores = Array(MAX_NUMBER + 1).fill(0);
  const total = draws.length || 1;
  draws.forEach((draw, index) => {
    const weight = 1 + (index / total) * recencyWeight;
    draw.numbers.forEach((number) => { scores[number] += weight; });
  });
  return scores.slice(1).map((score, index) => ({ number: index + 1, score }))
    .sort((a, b) => b.score - a.score || a.number - b.number);
}

function pickTop(ranked: Array<{ number: number; score: number }>) {
  return ranked.slice(0, DRAW_SIZE).map((item) => item.number).sort((a, b) => a - b);
}

function measureHoldout(
  draws: Draw[],
  start: number,
  predict: (targetIndex: number, priorDraws: Draw[]) => number[],
  name: string,
  note: string,
) {
  const holdout = draws.slice(start);
  let hits = 0;
  let exact = 0;
  let threeHitDraws = 0;
  holdout.forEach((actual, offset) => {
    const priorDraws = draws.slice(0, start + offset);
    const predicted = predict(start + offset, priorDraws);
    const actualSet = new Set(actual.numbers);
    const drawHits = predicted.filter((number) => actualSet.has(number)).length;
    hits += drawHits;
    if (drawHits === DRAW_SIZE) exact += 1;
    if (drawHits >= 3) threeHitDraws += 1;
  });
  const attempts = Math.max(1, holdout.length);
  return {
    name,
    threeHitRate: Number((threeHitDraws / attempts).toFixed(4)),
    averageHits: Number((hits / attempts).toFixed(3)),
    exactMatchRate: Number((exact / attempts).toFixed(6)),
    note,
  };
}

function combinations(n: number, k: number) {
  let result = 1;
  for (let index = 1; index <= k; index += 1) result = result * (n - index + 1) / index;
  return result;
}

function randomBaseline() {
  const total = combinations(MAX_NUMBER, DRAW_SIZE);
  let threeHitProbability = 0;
  for (let hits = 3; hits <= DRAW_SIZE; hits += 1) {
    threeHitProbability += combinations(DRAW_SIZE, hits) * combinations(MAX_NUMBER - DRAW_SIZE, DRAW_SIZE - hits) / total;
  }
  return {
    name: "Uniform random benchmark",
    threeHitRate: Number(threeHitProbability.toFixed(6)),
    averageHits: Number((DRAW_SIZE * DRAW_SIZE / MAX_NUMBER).toFixed(3)),
    exactMatchRate: Number((1 / total).toFixed(10)),
    note: "Exact mathematical expectation for a fair 6-of-59 draw; not a trained predictor.",
  };
}

function buildAnalysis(draws: Draw[]) {
  currentDrawsForContext.clear();
  const holdoutStart = Math.max(MIN_HISTORY + 1, Math.floor(draws.length * 0.7));
  const logisticHoldout = trainLogisticModel(makeTrainingRows(draws, holdoutStart));
  const logisticHoldoutContext = createContext(draws, holdoutStart);
  const logisticMetrics = (() => {
    const holdout = draws.slice(holdoutStart);
    let hits = 0;
    let exact = 0;
    let threeHitDraws = 0;
    holdout.forEach((actual, offset) => {
      const targetIndex = holdoutStart + offset;
      const ranked = predictLogistic(logisticHoldout, logisticHoldoutContext);
      const actualSet = new Set(actual.numbers);
      const drawHits = pickTop(ranked).filter((number) => actualSet.has(number)).length;
      hits += drawHits;
      if (drawHits === DRAW_SIZE) exact += 1;
      if (drawHits >= 3) threeHitDraws += 1;
      currentDrawsForContext.set(targetIndex, draws[targetIndex]);
      addDraw(logisticHoldoutContext, draws[targetIndex], targetIndex);
    });
    const attempts = Math.max(1, holdout.length);
    return {
      name: "Regularized logistic model",
      threeHitRate: Number((threeHitDraws / attempts).toFixed(4)),
      averageHits: Number((hits / attempts).toFixed(3)),
      exactMatchRate: Number((exact / attempts).toFixed(6)),
      note: "Supervised next-draw inclusion model using rolling history, recency, and gap features; evaluated chronologically.",
    };
  })();
  const modelMetrics = [
    measureHoldout(draws, holdoutStart, (_index, prior) => pickTop(scoreNumbers(prior, 0)), "Frequency baseline", "Ranks numbers by historical occurrence rate."),
    measureHoldout(draws, holdoutStart, (_index, prior) => pickTop(scoreNumbers(prior, 2.5)), "Recency-weighted baseline", "Blends long-run frequency with more recent draw history."),
    logisticMetrics,
    randomBaseline(),
  ];
  const fullModel = trainLogisticModel(makeTrainingRows(draws, draws.length));
  const finalContext = createContext(draws, draws.length);
  const logisticRanked = predictLogistic(fullModel, finalContext);
  const frequencyPick = pickTop(scoreNumbers(draws, 0));
  const recencyPick = pickTop(scoreNumbers(draws, 2.5));
  const logisticPick = pickTop(logisticRanked);
  const topStats = Array.from({ length: MAX_NUMBER }, (_, index) => {
    const number = index + 1;
    const occurrences = draws.filter((draw) => draw.numbers.includes(number));
    return { number, count: occurrences.length };
  }).sort((a, b) => b.count - a.count || a.number - b.number);
  const recent = draws.slice(-20);
  const totalNumbers = Math.max(1, draws.length * DRAW_SIZE);
  const numberStats = Array.from({ length: MAX_NUMBER }, (_, index) => {
    const number = index + 1;
    const occurrences = draws.filter((draw) => draw.numbers.includes(number));
    const recentCount = recent.filter((draw) => draw.numbers.includes(number)).length;
    return {
      number,
      count: occurrences.length,
      rate: Number((occurrences.length / totalNumbers).toFixed(4)),
      recentCount,
      lastSeen: occurrences.at(-1)?.drawDate ?? "Not observed",
    };
  });
  const trendBlockSize = Math.ceil(draws.length / 12);
  const trends = Array.from({ length: Math.min(12, Math.ceil(draws.length / trendBlockSize)) }, (_, index) => {
    const rows = draws.slice(index * trendBlockSize, Math.min(draws.length, (index + 1) * trendBlockSize));
    return {
      period: `Block ${index + 1}`,
      averageSum: Number((rows.reduce((sum, draw) => sum + draw.sum, 0) / rows.length).toFixed(1)),
      averageOdd: Number((rows.reduce((sum, draw) => sum + draw.oddCount, 0) / rows.length).toFixed(2)),
    };
  });
  const latest = draws.at(-1);
  return {
    source: API_URL,
    game: "NY Lottery winning numbers",
    fetchedAt: new Date().toISOString(),
    drawCount: draws.length,
    latestDraw: latest,
    draws: draws.slice(-60).reverse(),
    numberStats,
    trends,
    modelMetrics,
    predictions: [
      {
        model: "Regularized logistic model",
        numbers: logisticPick,
        rationale: "Ranks each number with a supervised model trained on earlier draws. Historical relationships can disappear; the set has no better guaranteed odds than any other valid set.",
      },
      {
        model: "Recency-weighted baseline",
        numbers: recencyPick,
        rationale: "Combines long-run occurrence with recency-weighted history; it is a descriptive heuristic, not a forecast.",
      },
      {
        model: "Frequency baseline",
        numbers: frequencyPick,
        rationale: "A transparent frequency-only benchmark for comparison, not a promise of future outcomes.",
      },
    ],
    insights: [
      `The dataset contains ${draws.length.toLocaleString()} valid draws. The latest draw was ${latest?.drawDate ?? "not available"}.`,
      `The most frequent historical numbers are ${topStats.slice(0, 5).map((item) => item.number).join(", ")}.`,
      `Uniform random selection has an expected ${randomBaseline().averageHits} matching numbers per 6-number ticket in a fair 6-of-${MAX_NUMBER} draw.`,
      "Backtests use a chronological holdout, and the uniform random benchmark provides a baseline for judging model results.",
      "Lottery draws are designed to be random. These rankings describe history and should not be treated as a reliable edge.",
    ],
  };
}

router.get("/lottery/analysis", async (req, res) => {
  const requested = Number(req.query.limit ?? 500);
  const limit = Number.isFinite(requested) ? Math.min(2000, Math.max(100, Math.round(requested))) : 500;
  try {
    if (!cached || cached.expiresAt < Date.now() || cached.payload.drawCount < limit) {
      const response = await fetch(`${API_URL}?$limit=${limit}&$order=draw_date%20DESC`);
      if (!response.ok) {
        res.status(502).json({ message: `NY Lottery data source returned ${response.status}.` });
        return;
      }
      const entries = (await response.json()) as RawEntry[];
      const draws = parseDraws(entries);
      if (draws.length < 40) {
        res.status(502).json({ message: "The NY Lottery data source returned too few valid draws for analysis." });
        return;
      }
      cached = { expiresAt: Date.now() + CACHE_TTL_MS, payload: buildAnalysis(draws) };
    }
    const payload = GetLotteryAnalysisResponse.parse(cached.payload);
    res.json(payload);
  } catch (error) {
    req.log.error({ err: error }, "Lottery analysis request failed");
    res.status(502).json({ message: "Unable to fetch or analyze NY Lottery data right now." });
  }
});

export default router;