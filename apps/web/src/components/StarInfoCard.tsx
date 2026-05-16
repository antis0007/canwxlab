import type { Star } from "../lib/celestialSphere";

// COSMIC-TODO(A): On open, fire a debounced fetch to the API:
//   GET /api/cosmic/star/{hipId}        → richer Hipparcos/Gaia astrometry
//   GET /api/cosmic/exoplanets/{host}   → NASA Exoplanet Archive live results
// Show a small "loading…" spinner while in flight; cache responses per session.
// Render extra fields when present (parallax, radial velocity, age, metallicity).
// See docs/cosmic-scope-roadmap.md §3.2 and §9 Phase A.

interface StarInfoCardProps {
  star: Star;
  onClose: () => void;
}

function fmt(n: number | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  return n.toFixed(digits);
}

export function StarInfoCard({ star, onClose }: StarInfoCardProps) {
  const simbadQuery = encodeURIComponent(star.name);
  const wikiQuery = encodeURIComponent(star.name + " (star)");

  return (
    <div className="wb-star-card" role="dialog" aria-label={`Star info: ${star.name}`}>
      <header className="wb-star-card-head">
        <div>
          <div className="wb-star-card-name">{star.name}</div>
          {star.bayer && <div className="wb-star-card-bayer">{star.bayer}{star.constellation ? ` · ${star.constellation}` : ""}</div>}
        </div>
        <button type="button" className="wb-star-card-close" onClick={onClose} aria-label="Close">×</button>
      </header>

      <dl className="wb-star-card-grid">
        <dt>App. mag</dt>           <dd>{fmt(star.mag)}</dd>
        <dt>Distance</dt>           <dd>{star.distanceLy != null ? `${fmt(star.distanceLy, 1)} ly` : "—"}</dd>
        <dt>Spectral</dt>           <dd>{star.spectralType ?? "—"}</dd>
        <dt>Mass</dt>               <dd>{star.massSolar != null ? `${fmt(star.massSolar)} M☉` : "—"}</dd>
        <dt>Radius</dt>             <dd>{star.radiusSolar != null ? `${fmt(star.radiusSolar)} R☉` : "—"}</dd>
        <dt>Luminosity</dt>         <dd>{star.luminositySolar != null ? `${fmt(star.luminositySolar, 0)} L☉` : "—"}</dd>
        <dt>RA</dt>                 <dd>{fmt(star.ra, 3)}°</dd>
        <dt>Dec</dt>                <dd>{fmt(star.dec, 3)}°</dd>
        {star.hostsExoplanets && (
          <>
            <dt>Exoplanets</dt>
            <dd>{star.exoplanets?.length ? star.exoplanets.join(", ") : "Confirmed (per NASA Exoplanet Archive)"}</dd>
          </>
        )}
      </dl>

      {star.notes && <p className="wb-star-card-notes">{star.notes}</p>}

      <footer className="wb-star-card-links">
        <a href={`https://simbad.u-strasbg.fr/simbad/sim-basic?Ident=${simbadQuery}`} target="_blank" rel="noreferrer">SIMBAD</a>
        <a href={`https://en.wikipedia.org/wiki/Special:Search?search=${wikiQuery}`} target="_blank" rel="noreferrer">Wikipedia</a>
        {star.hostsExoplanets && (
          <a
            href={`https://exoplanetarchive.ipac.caltech.edu/cgi-bin/TblView/nph-tblView?app=ExoTbls&config=PSCompPars&constraint=hostname%20like%20%27${simbadQuery}%27`}
            target="_blank"
            rel="noreferrer"
          >NASA Exoplanet Archive</a>
        )}
      </footer>
    </div>
  );
}
