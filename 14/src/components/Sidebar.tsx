import { NavLink } from 'react-router-dom';
import {
  Battery,
  Gauge,
  Activity,
  Zap,
  History,
  BarChart3,
  CircleDot
} from 'lucide-react';

interface NavItem {
  path: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const navItems: NavItem[] = [
  { path: '/monitor', label: '实时监控', Icon: Gauge },
  { path: '/soh', label: 'SOH估算', Icon: Activity },
  { path: '/balance', label: '均衡管理', Icon: Zap },
  { path: '/history', label: '历史回放', Icon: History },
  { path: '/report', label: '报表导出', Icon: BarChart3 },
];

export default function Sidebar() {
  return (
    <aside className="w-[200px] shrink-0 h-full bg-bms-panel border-r border-bms-border flex flex-col shadow-inner-panel">
      <div className="p-5 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-md bg-bms-accent/10 border border-bms-accent/40 shadow-glow-cyan">
            <Battery className="w-6 h-6 text-bms-accent" />
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-bold tracking-wider text-bms-accent drop-shadow-[0_0_8px_rgba(0,240,255,0.5)]">
              BMS-HMS
            </span>
            <span className="text-[10px] text-bms-textDim tracking-wide">
              锂电池健康管理
            </span>
          </div>
        </div>
      </div>

      <div className="h-px mx-4 bg-gradient-to-r from-transparent via-bms-accent/40 to-transparent" />

      <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
        {navItems.map(({ path, label, Icon }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              `
                relative flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium
                transition-all duration-200 group
                ${isActive
                  ? 'bg-bms-accent/15 text-bms-accent shadow-glow-cyan border border-bms-accent/40'
                  : 'text-bms-textDim hover:text-bms-text hover:bg-bms-bg/50 border border-transparent hover:border-bms-border/60'
                }
              `
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`
                    absolute left-0 top-1/2 -translate-y-1/2 w-1 rounded-r-full
                    transition-all duration-200
                    ${isActive
                      ? 'h-6 bg-bms-accent shadow-[0_0_8px_rgba(0,240,255,0.8)]'
                      : 'h-0 bg-transparent group-hover:h-4 group-hover:bg-bms-accent/50'
                    }
                  `}
                />
                <Icon
                  className={`
                    w-5 h-5 shrink-0 transition-all duration-200
                    ${isActive ? 'drop-shadow-[0_0_6px_rgba(0,240,255,0.6)]' : 'group-hover:scale-110'}
                  `}
                />
                <span className="tracking-wide">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="h-px mx-4 bg-gradient-to-r from-transparent via-bms-border/60 to-transparent" />

      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="relative">
            <CircleDot className="w-3 h-3 text-bms-ok animate-pulse" />
            <span className="absolute inset-0 rounded-full bg-bms-ok/40 animate-ping" />
          </div>
          <span className="text-[11px] text-bms-ok font-medium">在线</span>
        </div>
        <span className="text-[10px] text-bms-textDim font-mono">v1.0.0</span>
      </div>
    </aside>
  );
}
