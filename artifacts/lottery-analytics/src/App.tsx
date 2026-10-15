import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Download,
  FileCode2,
  FileText,
  Gauge,
  Info,
  LayoutDashboard,
  Menu,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Sun,
  Table2,
  Target,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  getGetLotteryAnalysisQueryKey,
  type LotteryAnalysis,
  type LotteryDraw,
  type ModelMetric,
  type NumberStat,
  type Prediction,
  type TrendPoint,
  useGetLotteryAnalysis,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});

const CHART_COLORS = {
  yellow: '#f2c94c',
  cyan: '#62d8d2',
  coral: '#ef766e',
  lilac: '#ae9be8',
  mint: '#88c99e',
  ink: '#0b101b',
};

const BALL_COLORS = ['ball-yellow', 'ball-cyan', 'ball-coral', 'ball-lilac', 'ball-mint'];

function formatDate(value: string, includeYear = false) {
  if (value.includes('T')) {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      ...(includeYear ? { year: 'numeric' } : {}),
    }).format(new Date(value));
  }
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' } : {}),
  }).format(new Date(year, month - 1, day));
}

function formatPercent(value: number) {
  const normalized = value <= 1 ? value * 100 : value;
  return `${normalized.toFixed(1)}%`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatUpdatedAt(value?: number) {
  if (!value) return 'Awaiting first sync';
  const date = new Date(value);
  return `${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

function csvEscape(value: unknown) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCsv(analysis: LotteryAnalysis) {
  const rows: string[][] = [
    ['NY lottery analysis report'],
    ['Source', analysis.source],
    ['Game', analysis.game],
    ['Fetched at', analysis.fetchedAt],
    [],
    ['Recent draws'],
    ['Draw date', 'Numbers', 'Sum', 'Odd count', 'Consecutive pairs'],
    ...analysis.draws.map((draw) => [
      draw.drawDate,
      draw.numbers.join(' · '),
      String(draw.sum),
      String(draw.oddCount),
      String(draw.consecutivePairs),
    ]),
    [],
    ['Number frequency'],
    ['Number', 'All-time count', 'Rate', 'Recent count', 'Last seen'],
    ...analysis.numberStats.map((stat) => [
      String(stat.number),
      String(stat.count),
      String(stat.rate),
      String(stat.recentCount),
      stat.lastSeen,
    ]),
    [],
    ['Model backtests'],
    ['Model', 'Accuracy', 'Average hits', 'Exact match rate', 'Note'],
    ...analysis.modelMetrics.map((metric) => [
      metric.name,
      String(metric.threeHitRate),
      String(metric.averageHits),
      String(metric.exactMatchRate),
      metric.note,
    ]),
    [],
    ['Candidate sets'],
    ['Model', 'Numbers', 'Rationale'],
    ...analysis.predictions.map((prediction) => [
      prediction.model,
      prediction.numbers.join(' '),
      prediction.rationale,
    ]),
    [],
    ['Analyst notes'],
    ...analysis.insights.map((insight) => [insight]),
  ];
  downloadFile(
    'lottery-lab-analysis.csv',
    rows.map((row) => row.map(csvEscape).join(',')).join('\n'),
    'text/csv;charset=utf-8',
  );
}

function exportHtml(analysis: LotteryAnalysis) {
  const drawRows = analysis.draws
    .slice(0, 20)
    .map((draw) => `<tr><td>${escapeHtml(draw.drawDate)}</td><td>${draw.numbers.join(' · ')}</td><td>${draw.sum}</td><td>${draw.oddCount}</td></tr>`)
    .join('');
  const insightRows = analysis.insights.map((insight) => `<li>${escapeHtml(insight)}</li>`).join('');
  const metricRows = analysis.modelMetrics
    .map((metric) => `<tr><td>${escapeHtml(metric.name)}</td><td>${(metric.threeHitRate * 100).toFixed(2)}%</td><td>${metric.averageHits.toFixed(3)}</td><td>${(metric.exactMatchRate * 100).toPrecision(3)}%</td><td>${escapeHtml(metric.note)}</td></tr>`)
    .join('');
  const predictionRows = analysis.predictions
    .map((prediction) => `<tr><td>${escapeHtml(prediction.model)}</td><td>${prediction.numbers.join(' · ')}</td><td>${escapeHtml(prediction.rationale)}</td></tr>`)
    .join('');
  const numberRows = [...analysis.numberStats]
    .sort((a, b) => b.count - a.count || a.number - b.number)
    .slice(0, 15)
    .map((stat) => `<tr><td>${stat.number}</td><td>${stat.count}</td><td>${(stat.rate * 100).toFixed(2)}%</td><td>${stat.recentCount}</td></tr>`)
    .join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Lottery Lab report</title><style>
  body{font-family:system-ui,sans-serif;color:#172033;max-width:960px;margin:48px auto;padding:0 24px;line-height:1.5}
  h1{font-size:32px;margin-bottom:4px}h2{margin-top:34px;border-bottom:1px solid #d8dde7;padding-bottom:8px}
  .meta{color:#637089;font-size:14px}.lede{margin-top:26px;color:#45536b}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px;border-bottom:1px solid #e5e8ee;font-size:14px}th{color:#637089;font-size:12px;text-transform:uppercase;letter-spacing:.08em}
  .note{background:#fff6d7;border-left:4px solid #d9a91a;padding:14px 18px;margin-top:28px}
  </style></head><body><h1>Lottery Lab</h1><div class="meta">${escapeHtml(analysis.game)} · ${escapeHtml(analysis.source)} · fetched ${escapeHtml(analysis.fetchedAt)} · ${analysis.drawCount} draws analyzed</div>
  <p class="lede">A transparent statistical review of official NY Lottery history. Candidate sets are model outputs for inspection, not forecasts.</p>
  <h2>Recent draws</h2><table><thead><tr><th>Date</th><th>Numbers</th><th>Sum</th><th>Odd count</th></tr></thead><tbody>${drawRows}</tbody></table>
  <h2>Model backtests</h2><p>Chronological holdout comparison. “3+ hit rate” is the fraction of held-out draws where a six-number candidate matched at least three numbers.</p><table><thead><tr><th>Model</th><th>3+ hit rate</th><th>Average hits</th><th>Exact match rate</th><th>Method</th></tr></thead><tbody>${metricRows}</tbody></table>
  <h2>Candidate sets</h2><table><thead><tr><th>Model</th><th>Numbers</th><th>Rationale</th></tr></thead><tbody>${predictionRows}</tbody></table>
  <h2>Number frequency</h2><table><thead><tr><th>Number</th><th>Appearances</th><th>Share of all drawn numbers</th><th>Recent 20</th></tr></thead><tbody>${numberRows}</tbody></table>
  <h2>Observed notes</h2><ul>${insightRows}</ul><div class="note"><strong>Responsible use:</strong> Historical patterns and model backtests describe the past. They cannot predict a random draw or improve the underlying odds. Set a budget and play for entertainment.</div>
  </body></html>`;
  downloadFile('lottery-lab-analysis.html', html, 'text/html;charset=utf-8');
}

function Card({
  children,
  className = '',
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`lab-card ${className}`}>
      {children}
    </section>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="font-display mt-1 text-xl font-semibold tracking-tight text-foreground">{title}</h2>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

function Ball({ value, index, size = 'normal' }: { value: number; index: number; size?: 'normal' | 'large' }) {
  return (
    <span
      data-testid={`ball-number-${value}`}
      className={`lottery-ball ${BALL_COLORS[index % BALL_COLORS.length]} ${size === 'large' ? 'lottery-ball-large' : ''}`}
    >
      {value}
    </span>
  );
}

function IconButton({
  label,
  onClick,
  children,
  disabled = false,
  testId,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="icon-button print-hidden"
    >
      {children}
    </button>
  );
}

function EmptyState({ title, body, onRetry }: { title: string; body: string; onRetry?: () => void }) {
  return (
    <div className="empty-state" data-testid="empty-analysis-state">
      <div className="empty-orbit"><BarChart3 size={21} /></div>
      <h3 className="font-display text-base font-semibold">{title}</h3>
      <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
      {onRetry && (
        <button type="button" data-testid="button-empty-retry" onClick={onRetry} className="button-secondary mt-2">
          Try again
        </button>
      )}
    </div>
  );
}

function LoadingDashboard() {
  return (
    <div className="space-y-5" data-testid="loading-analysis">
      <div className="lab-skeleton h-48 w-full" />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[1, 2, 3, 4].map((item) => <div className="lab-skeleton h-28" key={item} />)}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="lab-skeleton h-80" />
        <div className="lab-skeleton h-80" />
      </div>
    </div>
  );
}

function Sidebar({
  mobileOpen,
  setMobileOpen,
  onNavigate,
}: {
  mobileOpen: boolean;
  setMobileOpen: (value: boolean) => void;
  onNavigate: (id: string) => void;
}) {
  const items = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'draw-history', label: 'Draw history', icon: Table2 },
    { id: 'patterns', label: 'Patterns', icon: TrendingUp },
    { id: 'models', label: 'Model room', icon: Gauge },
    { id: 'candidates', label: 'Candidates', icon: Target },
  ];
  return (
    <>
      {mobileOpen && <button type="button" data-testid="button-close-mobile-nav" className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <aside className={`app-sidebar ${mobileOpen ? 'app-sidebar-open' : ''}`}>
        <div className="flex items-center justify-between">
          <button type="button" data-testid="button-brand-home" className="brand-mark" onClick={() => onNavigate('overview')}>
            <span className="brand-signal"><Activity size={18} /></span>
            <span><strong className="font-display">Lottery</strong><em>LAB</em></span>
          </button>
          <button type="button" data-testid="button-close-nav" className="nav-close md:hidden" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X size={18} /></button>
        </div>
        <div className="mt-12">
          <p className="eyebrow px-3">Workspace</p>
          <nav className="mt-3 space-y-1" aria-label="Dashboard sections">
            {items.map(({ id, label, icon: NavIcon }, index) => (
              <button type="button" data-testid={`button-nav-${id}`} key={id} onClick={() => { onNavigate(id); setMobileOpen(false); }} className={`nav-item ${index === 0 ? 'nav-item-active' : ''}`}>
                <NavIcon size={17} strokeWidth={1.8} />
                <span>{label}</span>
                {index === 0 && <span className="nav-active-dot" />}
              </button>
            ))}
          </nav>
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <ShieldCheck size={17} />
            <div>
              <p className="text-xs font-semibold text-foreground">Method-first by design</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">No certainty claims. Every signal has a footnote.</p>
            </div>
          </div>
          <div className="mt-5 flex items-center justify-between px-3 text-[11px] text-muted-foreground">
            <span>NY · 6/59</span><span className="font-data">v1.0.4</span>
          </div>
        </div>
      </aside>
    </>
  );
}

function Header({
  isFetching,
  dataUpdatedAt,
  dataState,
  isDark,
  setIsDark,
  onRefresh,
  onCsv,
  onHtml,
  onOpenNav,
}: {
  isFetching: boolean;
  dataUpdatedAt: number;
  dataState: 'ready' | 'loading' | 'error';
  isDark: boolean;
  setIsDark: (value: boolean) => void;
  onRefresh: () => void;
  onCsv: () => void;
  onHtml: () => void;
  onOpenNav: () => void;
}) {
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(event.target as Node)) setExportOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <header className="app-header">
      <button type="button" data-testid="button-open-mobile-nav" className="mobile-menu md:hidden" aria-label="Open navigation" onClick={onOpenNav}><Menu size={21} /></button>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="header-kicker">Research console</span>
          <span className="header-separator" />
          <span className="header-kicker">New York</span>
        </div>
        <p className="mt-1 truncate text-sm text-muted-foreground">A clear view of what the draws say — and what they do not.</p>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <div className={`hidden items-center gap-2 rounded-full px-3 py-1.5 text-[11px] sm:flex ${dataState === 'error' ? 'data-status-error' : 'data-status-ready'}`} data-testid="status-official-data">
          <span className={`status-pulse ${dataState === 'error' ? 'status-pulse-error' : ''}`} /> {dataState === 'error' ? 'Feed needs attention' : dataState === 'loading' ? 'Connecting to feed' : 'Official feed'}
        </div>
        <span className="hidden text-[11px] text-muted-foreground lg:inline" data-testid="text-last-refresh">Synced {formatUpdatedAt(dataUpdatedAt)}</span>
        <IconButton testId="button-refresh-analysis" label="Refresh official data" onClick={onRefresh} disabled={isFetching}>
          <RefreshCw size={15} className={isFetching ? 'animate-spin' : ''} />
        </IconButton>
        <div ref={exportRef} className="relative">
          <button type="button" data-testid="button-open-export" aria-label="Open report downloads" onClick={() => setExportOpen((open) => !open)} className="icon-button print-hidden"><Download size={15} /><ChevronDown size={12} /></button>
          {exportOpen && (
            <div className="export-menu" data-testid="menu-report-downloads">
              <button type="button" data-testid="button-download-csv" onClick={() => { onCsv(); setExportOpen(false); }}><FileText size={15} /> Download CSV</button>
              <button type="button" data-testid="button-download-html" onClick={() => { onHtml(); setExportOpen(false); }}><FileCode2 size={15} /> Download HTML report</button>
            </div>
          )}
        </div>
        <IconButton testId="button-toggle-theme" label={isDark ? 'Switch to brighter lab mode' : 'Switch to observatory mode'} onClick={() => setIsDark(!isDark)}>
          {isDark ? <Sun size={15} /> : <Moon size={15} />}
        </IconButton>
      </div>
    </header>
  );
}

function LatestDraw({ draw, source, game }: { draw: LotteryDraw; source: string; game: string }) {
  return (
    <Card className="latest-draw overflow-hidden">
      <div className="latest-draw-scanline" />
      <div className="relative z-10 flex h-full flex-col justify-between gap-8 p-6 sm:p-8 lg:flex-row lg:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow text-primary">Latest official draw</span>
            <span className="tiny-badge"><Check size={11} /> Verified source</span>
          </div>
          <h1 className="font-display mt-3 text-3xl font-semibold tracking-[-0.04em] text-foreground sm:text-4xl">The latest signal.</h1>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">One observed outcome, held up to the light. Explore the distribution without turning it into a promise.</p>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Clock3 size={13} /> {formatDate(draw.drawDate, true)}</span>
            <span className="font-data text-primary/80">{game}</span>
            <span className="truncate">{source}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3" data-testid="latest-draw-numbers">
          {draw.numbers.map((number, index) => <Ball key={`${draw.drawDate}-${number}`} value={number} index={index} size="large" />)}
        </div>
      </div>
    </Card>
  );
}

function KpiCard({ label, value, detail, icon: KpiIcon, tone = 'yellow', testId }: { label: string; value: string; detail: string; icon: typeof Activity; tone?: string; testId: string }) {
  return (
    <div className="kpi-card" data-testid={testId}>
      <div className="flex items-start justify-between gap-2">
        <p className="kpi-label">{label}</p>
        <span className={`kpi-icon kpi-icon-${tone}`}><KpiIcon size={15} /></span>
      </div>
      <p className="font-display mt-4 text-[28px] font-semibold tracking-[-0.04em] text-foreground">{value}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{detail}</p>
    </div>
  );
}

function RecentDraws({ draws }: { draws: LotteryDraw[] }) {
  return (
    <Card id="draw-history" className="break-avoid">
      <div className="card-pad">
        <SectionHeading eyebrow="Observed outcomes" title="Recent draw history" description="The raw record behind every pattern on this page." action={<span className="data-count">{draws.length} shown</span>} />
        {draws.length === 0 ? <EmptyState title="No draws in this window" body="The official source returned no historical draws for this analysis." /> : (
          <div className="overflow-x-auto">
            <table className="data-table" data-testid="table-recent-draws">
              <thead><tr><th>Draw date</th><th>Numbers</th><th>Sum</th><th>Odd / even</th><th>Pairs</th></tr></thead>
              <tbody>
                {draws.slice(0, 8).map((draw, index) => (
                  <tr key={`${draw.drawDate}-${index}`} data-testid={`row-draw-${draw.drawDate}`}>
                    <td><span className="font-medium text-foreground">{formatDate(draw.drawDate, true)}</span></td>
                    <td><div className="flex min-w-[260px] items-center gap-1.5">{draw.numbers.map((number, ballIndex) => <Ball key={number} value={number} index={ballIndex} />)}</div></td>
                    <td className="font-data text-primary">{draw.sum}</td>
                    <td className="font-data text-muted-foreground">{draw.oddCount} / {draw.numbers.length - draw.oddCount}</td>
                    <td className="font-data text-muted-foreground">{draw.consecutivePairs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}

function FrequencyChart({ stats }: { stats: NumberStat[] }) {
  const chartData = useMemo(() => [...stats].sort((a, b) => b.count - a.count).slice(0, 15), [stats]);
  return (
    <Card id="patterns" className="break-avoid">
      <div className="card-pad">
        <SectionHeading eyebrow="Distribution" title="Number frequency" description="Most observed numbers across the returned history." action={<span className="chart-legend"><i className="legend-dot legend-yellow" /> all history</span>} />
        {chartData.length === 0 ? <EmptyState title="No frequency data" body="Frequency bars will appear once the official draw history is available." /> : (
          <div className="h-[270px] w-full" data-testid="chart-number-frequency">
            <ResponsiveContainer width="100%" height="100%" debounce={0}>
              <BarChart data={chartData} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="rgba(165,184,214,0.12)" vertical={false} />
                <XAxis dataKey="number" tick={{ fontSize: 11, fill: '#8290a8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#8290a8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip cursor={{ fill: 'rgba(242,201,76,0.06)' }} contentStyle={{ background: '#111a2a', border: '1px solid #2a3952', borderRadius: 10, color: '#f3efdf', fontSize: 12 }} />
                <Bar dataKey="count" name="Draw appearances" fill={CHART_COLORS.yellow} fillOpacity={0.88} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {chartData.map((entry, index) => <Cell key={entry.number} fill={index === 0 ? CHART_COLORS.coral : CHART_COLORS.yellow} fillOpacity={index === 0 ? 1 : 0.82} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="mt-4 flex items-center gap-2 border-t border-border/60 pt-3 text-[11px] text-muted-foreground"><Info size={13} className="text-primary" /> Frequency is descriptive, not predictive. Each draw remains independent.</div>
      </div>
    </Card>
  );
}

function TrendChart({ trends }: { trends: TrendPoint[] }) {
  return (
    <Card className="break-avoid">
      <div className="card-pad">
        <SectionHeading eyebrow="Shape of the record" title="Trend watch" description="Rolling averages give context, not a forecast." action={<span className="chart-legend"><i className="legend-dot legend-cyan" /> sum <i className="legend-dot legend-lilac ml-2" /> odd count</span>} />
        {trends.length === 0 ? <EmptyState title="No trend points" body="Trend lines need more than one period of observed history." /> : (
          <div className="h-[270px] w-full" data-testid="chart-trends">
            <ResponsiveContainer width="100%" height="100%" debounce={0}>
              <LineChart data={trends} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid stroke="rgba(165,184,214,0.12)" vertical={false} />
                <XAxis dataKey="period" tick={{ fontSize: 11, fill: '#8290a8' }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="sum" tick={{ fontSize: 11, fill: '#8290a8' }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="odd" orientation="right" tick={{ fontSize: 11, fill: '#8290a8' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: '#111a2a', border: '1px solid #2a3952', borderRadius: 10, color: '#f3efdf', fontSize: 12 }} />
                <Line yAxisId="sum" type="monotone" dataKey="averageSum" name="Average sum" stroke={CHART_COLORS.cyan} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: CHART_COLORS.cyan, stroke: '#111a2a', strokeWidth: 2 }} isAnimationActive={false} />
                <Line yAxisId="odd" type="monotone" dataKey="averageOdd" name="Average odd count" stroke={CHART_COLORS.lilac} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: CHART_COLORS.lilac, stroke: '#111a2a', strokeWidth: 2 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="mt-4 flex items-center gap-2 border-t border-border/60 pt-3 text-[11px] text-muted-foreground"><CircleHelp size={13} className="text-cyan" /> A changing average does not imply the next draw will follow it.</div>
      </div>
    </Card>
  );
}

function ModelRoom({ metrics }: { metrics: ModelMetric[] }) {
  return (
    <Card id="models" className="break-avoid">
      <div className="card-pad">
        <SectionHeading eyebrow="Model room" title="Backtests, side by side" description="Historical evaluation only. These scores are not future-draw guarantees." action={<span className="tiny-badge tiny-badge-muted"><Gauge size={11} /> backtest</span>} />
        {metrics.length === 0 ? <EmptyState title="No model evaluations" body="Model comparisons will appear when the analysis endpoint returns backtest metrics." /> : (
          <div className="space-y-3" data-testid="model-comparison">
            {metrics.map((metric, index) => (
              <div className="model-row" key={metric.name} data-testid={`row-model-${index}`}>
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`model-index model-index-${index % 3}`}>{String(index + 1).padStart(2, '0')}</span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{metric.name}</p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{metric.note}</p>
                  </div>
                </div>
                <div className="hidden items-center gap-5 text-right sm:flex">
                  <div><p className="metric-value">{formatPercent(metric.threeHitRate)}</p><p className="metric-label">3+ hit rate</p></div>
                  <div><p className="metric-value">{metric.averageHits.toFixed(2)}</p><p className="metric-label">avg hits</p></div>
                  <div><p className="metric-value">{formatPercent(metric.exactMatchRate)}</p><p className="metric-label">exact match</p></div>
                </div>
                <div className="sm:hidden"><p className="metric-value">{formatPercent(metric.threeHitRate)}</p><p className="metric-label">3+ hit rate</p></div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex items-start gap-2 border-t border-border/60 pt-3 text-[11px] leading-relaxed text-muted-foreground"><AlertTriangle size={13} className="mt-0.5 shrink-0 text-coral" /> A model can score well against a historical slice and still have no edge over a random future draw.</div>
      </div>
    </Card>
  );
}

function Candidates({ predictions }: { predictions: Prediction[] }) {
  return (
    <Card id="candidates" className="break-avoid">
      <div className="card-pad">
        <SectionHeading eyebrow="For inspection, not instruction" title="Prediction candidates" description="Candidate sets surfaced by the supplied models, with the reasoning shown in plain language." />
        {predictions.length === 0 ? <EmptyState title="No candidates returned" body="This is a valid analysis state. There are no model candidates to interpret right now." /> : (
          <div className="grid gap-3 md:grid-cols-2" data-testid="prediction-candidates">
            {predictions.map((prediction, index) => (
              <div className={`candidate-card candidate-card-${index % 3}`} key={`${prediction.model}-${index}`} data-testid={`card-prediction-${index}`}>
                <div className="flex items-start justify-between gap-3">
                  <div><p className="eyebrow text-muted-foreground">{prediction.model}</p><p className="mt-1 text-sm font-semibold text-foreground">Candidate set {String(index + 1).padStart(2, '0')}</p></div>
                  <span className="confidence-chip"><Target size={12} /> Set {String(index + 1).padStart(2, '0')}</span>
                </div>
                <div className="my-5 flex flex-wrap gap-2">{prediction.numbers.map((number, numberIndex) => <Ball key={number} value={number} index={numberIndex} />)}</div>
                <div className="border-t border-border/60 pt-3"><p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">Rationale</p><p className="text-xs leading-relaxed text-muted-foreground">{prediction.rationale}</p></div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function Insights({ insights }: { insights: string[] }) {
  return (
    <Card className="insights-card break-avoid">
      <div className="card-pad">
        <div className="flex items-start gap-4">
          <div className="insights-icon"><Sparkles size={18} /></div>
          <div className="min-w-0 flex-1">
            <p className="eyebrow text-primary">Analyst notes</p>
            <h2 className="font-display mt-1 text-xl font-semibold tracking-tight text-foreground">What stands out</h2>
            <div className="mt-5 space-y-4" data-testid="list-analysis-insights">
              {insights.length === 0 ? <p className="text-sm text-muted-foreground">No analyst notes were returned for this window.</p> : insights.map((insight, index) => (
                <div className="insight-row" key={`${insight}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><p>{insight}</p></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function ResponsibleUse() {
  return (
    <div className="responsible-note" data-testid="responsible-use-note">
      <div className="responsible-icon"><ShieldCheck size={20} /></div>
      <div>
        <p className="eyebrow text-primary">Keep the boundary visible</p>
        <h2 className="font-display mt-1 text-lg font-semibold text-foreground">A research companion, not a crystal ball.</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">Lottery draws are random. Historical frequency, trend lines, and backtest scores help you inspect the record; they cannot make a future number more likely. If you play, set a spending limit before you start and treat it as entertainment.</p>
      </div>
    </div>
  );
}

function Dashboard() {
  const params = useMemo(() => ({ limit: 500 }), []);
  const query = useGetLotteryAnalysis(params, { query: { queryKey: getGetLotteryAnalysisQueryKey(params) } });
  const [isDark, setIsDark] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [exportMessage, setExportMessage] = useState('');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  const analysis = query.data;
  const loading = query.isLoading || query.isFetching;
  const averageSum = analysis?.draws.length ? analysis.draws.reduce((sum, draw) => sum + draw.sum, 0) / analysis.draws.length : 0;
  const topNumber = analysis?.numberStats.length ? [...analysis.numberStats].sort((a, b) => b.count - a.count)[0] : undefined;
  const averageOdd = analysis?.draws.length ? analysis.draws.reduce((sum, draw) => sum + draw.oddCount, 0) / analysis.draws.length : 0;
  const errorMessage = query.error && typeof query.error === 'object' && 'message' in query.error ? String(query.error.message) : 'The official analysis feed could not be reached.';

  const handleExport = (kind: 'csv' | 'html') => {
    if (!analysis) return;
    if (kind === 'csv') exportCsv(analysis);
    else exportHtml(analysis);
    setExportMessage(`${kind.toUpperCase()} report downloaded`);
    window.setTimeout(() => setExportMessage(''), 3200);
  };

  const navigate = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="app-frame">
      <Sidebar mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} onNavigate={navigate} />
      <main className="app-main">
        <Header isFetching={query.isFetching} dataUpdatedAt={query.dataUpdatedAt} dataState={query.isError ? 'error' : query.isLoading ? 'loading' : 'ready'} isDark={isDark} setIsDark={setIsDark} onRefresh={() => query.refetch()} onCsv={() => handleExport('csv')} onHtml={() => handleExport('html')} onOpenNav={() => setMobileOpen(true)} />
        <div className="dashboard-content lab-grid">
          <div className="mx-auto max-w-[1440px]">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4 animate-rise" id="overview">
              <div>
                <p className="eyebrow">Analysis / overview</p>
                <h2 className="font-display mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground sm:text-[32px]">The observatory floor</h2>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="data-count">{analysis?.drawCount ?? '—'} draws indexed</span>
                <span className="data-count">window · 500 max</span>
              </div>
            </div>

            {loading && !analysis ? <LoadingDashboard /> : query.isError && !analysis ? (
              <Card className="error-card">
                <div className="error-icon"><AlertTriangle size={22} /></div>
                <div><p className="font-display text-lg font-semibold text-foreground">The feed went quiet.</p><p className="mt-1 text-sm text-muted-foreground">{errorMessage}</p><button type="button" data-testid="button-retry-analysis" onClick={() => query.refetch()} className="button-primary mt-4">Retry connection</button></div>
              </Card>
            ) : !analysis ? (
              <Card><EmptyState title="No analysis available" body="The source returned an empty response. Try a fresh sync when you are ready." onRetry={() => query.refetch()} /></Card>
            ) : (
              <div className="space-y-5">
                {query.isFetching && <div className="refresh-ribbon" data-testid="status-refreshing"><RefreshCw size={13} className="animate-spin" /> Updating official data while you inspect the record</div>}
                <LatestDraw draw={analysis.latestDraw} source={analysis.source} game={analysis.game} />
                {exportMessage && <div className="download-toast" data-testid="status-download"><Check size={14} /> {exportMessage}</div>}
                <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                  <KpiCard testId="kpi-draw-count" label="Draws indexed" value={formatNumber(analysis.drawCount)} detail={`Official history · ${analysis.game}`} icon={Table2} tone="yellow" />
                  <KpiCard testId="kpi-number-space" label="Number space" value={formatNumber(analysis.numberStats.length)} detail="Distinct numbers observed" icon={Target} tone="cyan" />
                  <KpiCard testId="kpi-average-sum" label="Average draw sum" value={averageSum ? averageSum.toFixed(1) : '—'} detail="Across returned draws" icon={Activity} tone="coral" />
                  <KpiCard testId="kpi-top-number" label="Most frequent" value={topNumber ? `#${topNumber.number}` : '—'} detail={topNumber ? `${topNumber.count} appearances · descriptive only` : 'No frequency data'} icon={TrendingUp} tone="lilac" />
                </div>
                <div className="grid gap-5 xl:grid-cols-[1.4fr_0.6fr]">
                  <RecentDraws draws={analysis.draws} />
                  <div className="space-y-5">
                    <Card className="stat-card">
                      <div className="card-pad">
                        <div className="flex items-center justify-between"><p className="eyebrow">Latest composition</p><Activity size={16} className="text-primary" /></div>
                        <p className="font-display mt-4 text-3xl font-semibold tracking-tight text-foreground">{analysis.latestDraw.sum}</p>
                        <p className="mt-1 text-xs text-muted-foreground">draw sum · latest official result</p>
                        <div className="mt-5 grid grid-cols-2 gap-2">
                          <div className="micro-stat"><span>Odd count</span><strong>{analysis.latestDraw.oddCount}</strong></div>
                          <div className="micro-stat"><span>Pairs</span><strong>{analysis.latestDraw.consecutivePairs}</strong></div>
                        </div>
                        <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground"><span className="status-pulse status-pulse-static" /> Dataset updated {formatDate(analysis.latestDraw.drawDate, true)}</div>
                      </div>
                    </Card>
                    <Card className="stat-card">
                      <div className="card-pad">
                        <div className="flex items-center justify-between"><p className="eyebrow">Window context</p><BookOpen size={16} className="text-cyan" /></div>
                        <div className="mt-4 space-y-3">
                          <div className="context-line"><span>Average odd count</span><strong>{averageOdd.toFixed(1)}</strong></div>
                          <div className="context-line"><span>Source</span><strong className="max-w-[150px] truncate">{analysis.source}</strong></div>
                          <div className="context-line"><span>Fetched at</span><strong>{formatDate(analysis.fetchedAt, true)}</strong></div>
                        </div>
                      </div>
                    </Card>
                  </div>
                </div>
                <div className="grid gap-5 lg:grid-cols-2">
                  <FrequencyChart stats={analysis.numberStats} />
                  <TrendChart trends={analysis.trends} />
                </div>
                <div className="grid gap-5 xl:grid-cols-2">
                  <ModelRoom metrics={analysis.modelMetrics} />
                  <Insights insights={analysis.insights} />
                </div>
                <Candidates predictions={analysis.predictions} />
                <ResponsibleUse />
                <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pb-8 pt-5 text-[11px] text-muted-foreground">
                  <span>Lottery Lab · transparent analysis for NY draw history</span>
                  <span className="font-data">SOURCE: {analysis.source.toUpperCase()}</span>
                </footer>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;