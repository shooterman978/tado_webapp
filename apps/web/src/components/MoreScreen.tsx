/**
 * Mehr tab — minimal stub (screenshot bottom-nav).
 * @package @heizplan/web
 */

export function MoreScreen() {
  return (
    <div className="more">
      <h1 className="settings__title">Mehr</h1>
      <div className="settings-group">
        <p className="more__body">
          Hilfe, Info und Erweiterungen folgen. Fokus bleibt UI-Parität der Heizungs-Screens.
        </p>
        <p className="more__body more__body--muted">Heizplan · lokaler Stack · kein TadoLocal</p>
      </div>
    </div>
  );
}
