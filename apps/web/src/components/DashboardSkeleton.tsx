/**
 * First-paint skeleton for the automations dashboard.
 * @package @heizplan/web
 */

export function DashboardSkeleton() {
  return (
    <div className="dash-skeleton" aria-busy="true" aria-label="Lädt">
      <div className="dash-skeleton__promo skel" />
      <div className="dash-skeleton__title skel" />
      <div className="dash-skeleton__chip skel" />
      <p className="auto-home__label">Automatisierung</p>
      <div className="auto-home__grid" aria-hidden="true">
        <div className="skel skel--card" />
        <div className="skel skel--card" />
        <div className="skel skel--card" />
        <div className="skel skel--card" />
      </div>
      <p className="auto-home__label" style={{ marginTop: "1rem" }}>
        System
      </p>
      <div className="skel skel--group" aria-hidden="true" />
    </div>
  );
}
