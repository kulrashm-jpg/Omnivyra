import Link from 'next/link';
import { useRouter } from 'next/router';
import { getPrimaryNavForPath, getSecondaryNavForPath, isPathActive } from './navigationConfig';
import { useCompanyContext } from '../CompanyContext';
import { roleCanAccessArea } from '../../config/commandCenterCards';

export default function SectionNav() {
  const router = useRouter();
  const { userRole } = useCompanyContext();
  const items = getSecondaryNavForPath(router.pathname);
  const section = getPrimaryNavForPath(router.pathname);

  if (!section || items.length === 0) return null;

  // Don't surface a section's sub-tabs (e.g. "Create Quick Posts") to roles
  // that can't access that section — matches the header + dashboard gating so
  // a view-only user never sees actions they can't perform.
  const areaCardId =
    section.label === 'Content' ? 'blogs' : section.label === 'Campaigns' ? 'campaigns' : null;
  if (areaCardId && !roleCanAccessArea(userRole, areaCardId)) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
        You are in {section.label}
      </span>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const active = isPathActive(router.pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                active
                  ? 'border-sky-200 bg-sky-50 text-sky-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
              }`}
              aria-current={active ? 'page' : undefined}
            >
              {item.icon ? <item.icon className="h-3.5 w-3.5" /> : null}
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
