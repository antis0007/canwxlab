import type { Star } from "../lib/celestialSphere";
import type { WindowManager, ManagedWindow } from "../hooks/useWindowManager";
import { WindowShell } from "./WindowShell";

interface StarInfoCardProps {
  star: Star;
  wm: WindowManager;
  win: ManagedWindow;
}

function fmt(n: number | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  return n.toFixed(digits);
}

export function StarInfoCard({ star, wm, win }: StarInfoCardProps) {
  const simbadQuery = encodeURIComponent(star.name);
  const wikiQuery = encodeURIComponent(star.name + " (star)");

  return (
    <WindowShell
      id={win.id}
      title={star.name}
      subtitle={star.bayer ? `${star.bayer}${star.constellation ? ` · ${star.constellation}` : ""}` : undefined}
      icon="★"
      zIndex={win.zIndex}
      initialPosition={win.position}
      initialSize={win.size}
      onClose={() => wm.close(win.id)}
      onMinimize={() => wm.minimize(win.id)}
      onFocus={() => wm.bringToFront(win.id)}
      onMove={(pos) => wm.move(win.id, pos)}
      onResize={(size) => wm.resize(win.id, size)}
      wm={wm}
    >
      <dl className="wb-ep-grid">
        <dt>App. mag</dt>   <dd>{fmt(star.mag)}</dd>
        <dt>Distance</dt>   <dd>{star.distanceLy != null ? `${fmt(star.distanceLy, 1)} ly` : "—"}</dd>
        <dt>Spectral</dt>   <dd>{star.spectralType ?? "—"}</dd>
        <dt>Mass</dt>       <dd>{star.massSolar != null ? `${fmt(star.massSolar)} M☉` : "—"}</dd>
        <dt>Radius</dt>     <dd>{star.radiusSolar != null ? `${fmt(star.radiusSolar)} R☉` : "—"}</dd>
        <dt>Luminosity</dt> <dd>{star.luminositySolar != null ? `${fmt(star.luminositySolar, 0)} L☉` : "—"}</dd>
        <dt>RA</dt>         <dd>{fmt(star.ra, 3)}°</dd>
        <dt>Dec</dt>        <dd>{fmt(star.dec, 3)}°</dd>
        {star.hostsExoplanets && (
          <>
            <dt>Exoplanets</dt>
            <dd>{star.exoplanets?.length ? star.exoplanets.join(", ") : "Confirmed (per NASA)"}</dd>
          </>
        )}
      </dl>

      {star.notes && <p style={{ fontSize: 10, color: "var(--wb-muted)", marginTop: 6 }}>{star.notes}</p>}

      <div className="wb-ep-links">
        <a href={`https://simbad.u-strasbg.fr/simbad/sim-basic?Ident=${simbadQuery}`} target="_blank" rel="noreferrer">SIMBAD</a>
        <a href={`https://en.wikipedia.org/wiki/Special:Search?search=${wikiQuery}`} target="_blank" rel="noreferrer">Wikipedia</a>
        {star.hostsExoplanets && (
          <a href={`https://exoplanetarchive.ipac.caltech.edu/cgi-bin/TblView/nph-tblView?app=ExoTbls&config=PSCompPars&constraint=hostname%20like%20%27${simbadQuery}%27`} target="_blank" rel="noreferrer">NASA Exoplanet Archive</a>
        )}
      </div>
    </WindowShell>
  );
}
