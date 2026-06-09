import React, { useState, useEffect, useCallback } from "react";
import { loadGame, saveGame, subscribeGame } from "./storage";

/* ============================================================
   FANTASY WORLD CUP 2026 — Draft + Scoring + Live Standings
   ------------------------------------------------------------
   Scoring (matches the Redheadsports template exactly):
     Group stage:  Win = 3, Draw = 1, Loss = 0
     Knockout wins escalate by round:
       Round of 32 = 3, Round of 16 = 6, QF = 9, SF = 12, Final = 15
     Player total = group points + knockout points

   Shared state lives in Supabase, keyed by a game code in the URL
   (?game=XYZ). Everyone on the same link sees the same game, and
   edits sync in realtime. Last write wins.

   AUTO-PULL HOOK: see ingestMatchResult() near the bottom. Wire a
   real feed (e.g. API-Football) to call it and results populate
   themselves. Until then, results are tapped in manually.
   ============================================================ */

// 48 nations, in the template's odds order (favorites first → snake value)
const NATIONS = [
  "France","Spain","England","Brazil","Argentina","Portugal","Germany","Netherlands",
  "Belgium","Norway","Colombia","Morocco","Uruguay","United States","Switzerland","Japan",
  "Ecuador","Croatia","Mexico","Senegal","Türkiye","Sweden","Austria","Scotland",
  "Canada","Czech Republic","Ivory Coast","Ghana","Egypt","Paraguay","Algeria","South Korea",
  "Tunisia","Bosnia","Australia","Iran","DR Congo","South Africa","Cape Verde","Saudi Arabia",
  "Panama","Uzbekistan","Qatar","New Zealand","Iraq","Haiti","Curaçao","Jordan",
];

const KO_POINTS = { R32: 3, R16: 6, QF: 9, SF: 12, FINAL: 15 };
const KO_LABELS = { R32: "Round of 32", R16: "Round of 16", QF: "Quarterfinal", SF: "Semifinal", FINAL: "Final" };
const KO_ROUNDS = ["R32", "R16", "QF", "SF", "FINAL"];

const emptyState = () => ({
  phase: "setup",            // setup | draft | play
  players: [],               // [{id, name}]
  draftOrder: [],            // [playerId,...]
  picks: {},                 // { nation: playerId }
  groupResults: {},          // { nation: { w, d, l } }
  koResults: {},             // { nation: { R32:true, R16:true, ... } }
  rev: 0,
});

const fmt = (n) => (n == null ? 0 : n);

// ---- scoring ----
function groupPoints(res) {
  if (!res) return 0;
  return fmt(res.w) * 3 + fmt(res.d) * 1;
}
function koPoints(ko) {
  if (!ko) return 0;
  return KO_ROUNDS.reduce((s, r) => s + (ko[r] ? KO_POINTS[r] : 0), 0);
}
function playerScore(state, playerId) {
  let gs = 0, ko = 0;
  for (const nation of Object.keys(state.picks)) {
    if (state.picks[nation] !== playerId) continue;
    gs += groupPoints(state.groupResults[nation]);
    ko += koPoints(state.koResults[nation]);
  }
  return { gs, ko, total: gs + ko };
}

// snake draft sequence for N rounds
function snakeSequence(order, rounds) {
  const seq = [];
  for (let r = 0; r < rounds; r++) {
    const row = r % 2 === 0 ? order : [...order].reverse();
    seq.push(...row);
  }
  return seq;
}

// Read the game code from the URL (?game=XYZ). If none, default to "main"
// so a plain link still works. Different codes = separate games.
function getGameCode() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("game") || "main").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24) || "main";
}

export default function App() {
  const [state, setState] = useState(emptyState);
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [code] = useState(getGameCode);

  // load shared state on mount
  useEffect(() => {
    (async () => {
      try {
        const remote = await loadGame(code);
        if (remote) setState(remote);
      } catch (e) { /* fresh start */ }
      setLoaded(true);
    })();
  }, [code]);

  // persist + bump revision
  const commit = useCallback(async (updater) => {
    setState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      next.rev = (prev.rev || 0) + 1;
      (async () => {
        try {
          setSyncing(true);
          await saveGame(code, next);
        } catch (e) { /* keep local */ }
        finally { setSyncing(false); }
      })();
      return next;
    });
  }, [code]);

  // realtime: apply other devices' edits the instant they happen
  useEffect(() => {
    const unsub = subscribeGame(code, (remote) => {
      setState((local) => (remote.rev > (local.rev || 0) ? remote : local));
    });
    return unsub;
  }, [code]);

  if (!loaded) return <Shell><div style={S.muted}>Loading…</div></Shell>;

  return (
    <Shell syncing={syncing}>
      {state.phase === "setup" && <Setup state={state} commit={commit} />}
      {state.phase === "draft" && <Draft state={state} commit={commit} />}
      {state.phase === "play" && <Play state={state} commit={commit} />}
    </Shell>
  );
}

/* ----------------------------- SETUP ----------------------------- */
function Setup({ state, commit }) {
  const [count, setCount] = useState(6);
  const [names, setNames] = useState(["", "", "", "", "", ""]);

  const setN = (n) => {
    setCount(n);
    setNames((old) => {
      const next = [...old];
      next.length = n;
      for (let i = 0; i < n; i++) if (next[i] == null) next[i] = "";
      return next;
    });
  };

  const perPlayer = Math.floor(NATIONS.length / count);
  const ready = names.every((x) => x && x.trim());

  const begin = () => {
    const players = names.map((nm, i) => ({ id: `p${i}`, name: nm.trim() }));
    commit({ ...emptyState(), phase: "draftorder", players });
  };

  return (
    <>
      <Hero sub="Draft nations. Snake style. Earn points all tournament." />
      <Card title="Players">
        <div style={S.row}>
          {[3, 4, 6, 8].map((n) => (
            <button key={n} onClick={() => setN(n)} style={count === n ? S.pillOn : S.pill}>
              {n} players
            </button>
          ))}
        </div>
        <p style={S.note}>{perPlayer} nations each · {NATIONS.length - perPlayer * count} left undrafted</p>
        <div style={{ marginTop: 16 }}>
          {names.map((nm, i) => (
            <input
              key={i}
              value={nm}
              placeholder={`Player ${i + 1}`}
              onChange={(e) => setNames((o) => { const n = [...o]; n[i] = e.target.value; return n; })}
              style={S.input}
            />
          ))}
        </div>
        <button disabled={!ready} onClick={begin} style={ready ? S.primary : S.primaryOff}>
          Set draft order →
        </button>
      </Card>
    </>
  );
}

/* -------------------------- DRAFT ORDER -------------------------- */
function DraftOrderScreen({ state, commit }) {
  const [order, setOrder] = useState(state.players.map((p) => p.id));

  const randomize = () => {
    const a = [...order];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    setOrder(a);
  };
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const a = [...order]; [a[i], a[j]] = [a[j], a[i]]; setOrder(a);
  };
  const name = (id) => state.players.find((p) => p.id === id)?.name;

  return (
    <Card title="Draft order">
      <p style={S.note}>Round 1 picks in this order. It snakes back each round.</p>
      <div>
        {order.map((id, i) => (
          <div key={id} style={S.orderRow}>
            <span style={S.orderNum}>{i + 1}</span>
            <span style={{ flex: 1, fontWeight: 600 }}>{name(id)}</span>
            <button style={S.ghostSm} onClick={() => move(i, -1)}>↑</button>
            <button style={S.ghostSm} onClick={() => move(i, 1)}>↓</button>
          </div>
        ))}
      </div>
      <div style={{ ...S.row, marginTop: 14 }}>
        <button style={S.ghost} onClick={randomize}>🎲 Randomize</button>
        <button style={S.primary} onClick={() => commit((s) => ({ ...s, phase: "draft", draftOrder: order }))}>
          Start draft →
        </button>
      </div>
    </Card>
  );
}

/* ----------------------------- DRAFT ----------------------------- */
function Draft({ state, commit }) {
  if (state.phase === "draftorder") return <DraftOrderScreen state={state} commit={commit} />;

  const perPlayer = Math.floor(NATIONS.length / state.players.length);
  const seq = snakeSequence(state.draftOrder, perPlayer);
  const made = Object.keys(state.picks).length;
  const onClock = seq[made];
  const done = made >= seq.length;
  const name = (id) => state.players.find((p) => p.id === id)?.name;

  const pick = (nation) => {
    if (done) return;
    commit((s) => ({ ...s, picks: { ...s.picks, [nation]: onClock } }));
  };

  const upcoming = seq.slice(made, made + state.players.length).map(name);

  return (
    <>
      {!done ? (
        <div style={S.clock}>
          <span style={S.muted}>On the clock · pick {made + 1} of {seq.length}</span>
          <div style={S.clockName}>{name(onClock)}</div>
          <div style={S.upcoming}>Next: {upcoming.slice(1).join(" · ") || "—"}</div>
        </div>
      ) : (
        <div style={S.clock}>
          <div style={S.clockName}>Draft complete</div>
          <button style={{ ...S.primary, marginTop: 12 }} onClick={() => commit((s) => ({ ...s, phase: "play" }))}>
            Go to standings →
          </button>
        </div>
      )}

      <Card title="Available nations">
        <div style={S.nationGrid}>
          {NATIONS.map((n) => {
            const owner = state.picks[n];
            return (
              <button key={n} disabled={!!owner || done} onClick={() => pick(n)}
                style={owner ? S.nationTaken : S.nationFree}>
                <span>{n}</span>
                {owner && <span style={S.ownerTag}>{name(owner)}</span>}
              </button>
            );
          })}
        </div>
      </Card>

      <Rosters state={state} />
    </>
  );
}

function Rosters({ state }) {
  return (
    <Card title="Rosters">
      <div style={S.rosterWrap}>
        {state.draftOrder.map((id) => {
          const p = state.players.find((x) => x.id === id);
          const teams = Object.keys(state.picks).filter((n) => state.picks[n] === id);
          return (
            <div key={id} style={S.rosterCol}>
              <div style={S.rosterHead}>{p.name}</div>
              {teams.length ? teams.map((t) => <div key={t} style={S.rosterTeam}>{t}</div>)
                : <div style={S.muted}>—</div>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ------------------------------ PLAY ----------------------------- */
function Play({ state, commit }) {
  const [tab, setTab] = useState("standings");

  const standings = state.players
    .map((p) => ({ ...p, ...playerScore(state, p.id) }))
    .sort((a, b) => b.total - a.total);

  return (
    <>
      <div style={S.tabs}>
        {[["standings", "Standings"], ["group", "Group stage"], ["ko", "Knockout"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={tab === k ? S.tabOn : S.tab}>{l}</button>
        ))}
      </div>

      {tab === "standings" && (
        <Card title="Live standings">
          {standings.map((p, i) => (
            <div key={p.id} style={S.standRow}>
              <span style={S.rank}>{i + 1}</span>
              <span style={{ flex: 1, fontWeight: 600 }}>{p.name}</span>
              <span style={S.breakdown}>GS {p.gs} · KO {p.ko}</span>
              <span style={S.totalPts}>{p.total}</span>
            </div>
          ))}
        </Card>
      )}

      {tab === "group" && <GroupStage state={state} commit={commit} />}
      {tab === "ko" && <Knockout state={state} commit={commit} />}
    </>
  );
}

function GroupStage({ state, commit }) {
  const name = (id) => state.players.find((p) => p.id === id)?.name;
  const drafted = Object.keys(state.picks);

  const bump = (nation, field, delta) => {
    commit((s) => {
      const cur = s.groupResults[nation] || { w: 0, d: 0, l: 0 };
      const next = { ...cur, [field]: Math.max(0, fmt(cur[field]) + delta) };
      return { ...s, groupResults: { ...s.groupResults, [nation]: next } };
    });
  };

  return (
    <Card title="Group stage results">
      <p style={S.note}>Win +3 · Draw +1 · Loss 0. Tap to record each match (3 per nation).</p>
      {drafted.map((nation) => {
        const r = state.groupResults[nation] || { w: 0, d: 0, l: 0 };
        return (
          <div key={nation} style={S.gsRow}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{nation}</div>
              <div style={S.muted}>{name(state.picks[nation])} · {groupPoints(r)} pts</div>
            </div>
            {[["w", "W"], ["d", "D"], ["l", "L"]].map(([f, lbl]) => (
              <div key={f} style={S.stepper}>
                <button style={S.stepBtn} onClick={() => bump(nation, f, -1)}>–</button>
                <span style={S.stepVal}>{lbl} {fmt(r[f])}</span>
                <button style={S.stepBtn} onClick={() => bump(nation, f, 1)}>+</button>
              </div>
            ))}
          </div>
        );
      })}
    </Card>
  );
}

function Knockout({ state, commit }) {
  const name = (id) => state.players.find((p) => p.id === id)?.name;
  const drafted = Object.keys(state.picks);

  // Toggle a round win. Turning a win OFF clears every later round too,
  // so corrections never leave orphaned downstream points. Turning a win
  // ON also clears any "eliminated" flag, since the nation advanced.
  const toggleWin = (nation, round) => {
    commit((s) => {
      const cur = { ...(s.koResults[nation] || {}) };
      const idx = KO_ROUNDS.indexOf(round);
      const turningOn = !cur[round];
      cur[round] = turningOn;
      if (turningOn) {
        cur.out = false; // advanced, so not eliminated here
      } else {
        // clear this round's win and everything after it
        for (let i = idx; i < KO_ROUNDS.length; i++) cur[KO_ROUNDS[i]] = false;
      }
      return { ...s, koResults: { ...s.koResults, [nation]: cur } };
    });
  };

  // Mark a nation eliminated at its current stage: locks remaining rounds.
  const toggleOut = (nation) => {
    commit((s) => {
      const cur = { ...(s.koResults[nation] || {}) };
      cur.out = !cur.out;
      return { ...s, koResults: { ...s.koResults, [nation]: cur } };
    });
  };

  // A round is reachable only if every earlier round was won.
  const reachable = (ko, idx) => KO_ROUNDS.slice(0, idx).every((r) => ko[r]);

  return (
    <Card title="Knockout wins">
      <p style={S.note}>Tap each round a nation wins — the next round unlocks once they advance. Mark a nation out to lock its remaining rounds.</p>
      {drafted.map((nation) => {
        const ko = state.koResults[nation] || {};
        const isOut = !!ko.out;
        return (
          <div key={nation} style={S.koRow}>
            <div style={S.koHead}>
              <span style={{ fontWeight: 600 }}>
                {nation}{isOut && <span style={S.outTag}> · OUT</span>}
              </span>
              <span style={S.muted}>{name(state.picks[nation])} · {koPoints(ko)} pts</span>
            </div>
            <div style={S.koChips}>
              {KO_ROUNDS.map((r, i) => {
                const won = !!ko[r];
                const locked = isOut ? !won : !reachable(ko, i);
                const cls = won ? S.chipOn : locked ? S.chipLocked : S.chip;
                return (
                  <button key={r} disabled={locked} onClick={() => toggleWin(nation, r)} style={cls}>
                    {KO_LABELS[r].replace("Round of ", "R")} +{KO_POINTS[r]}
                  </button>
                );
              })}
              <button onClick={() => toggleOut(nation)} style={isOut ? S.outBtnOn : S.outBtn}>
                {isOut ? "Back in" : "Out"}
              </button>
            </div>
          </div>
        );
      })}
    </Card>
  );
}

/* ----------------- AUTO-PULL INTEGRATION HOOK -------------------
   When you wire a real feed, fetch fixtures and for each finished
   match call this with the result. It maps onto the same state
   the manual UI writes, so standings update identically.

   Example payload from a feed:
     { nation: "Brazil", stage: "group", outcome: "win" }
     { nation: "Brazil", stage: "ko", round: "QF", won: true }   // advanced
     { nation: "Brazil", stage: "ko", round: "QF", won: false }  // eliminated in QF
------------------------------------------------------------------ */
// eslint-disable-next-line no-unused-vars
function ingestMatchResult(commit, result) {
  if (result.stage === "group") {
    const field = result.outcome === "win" ? "w" : result.outcome === "draw" ? "d" : "l";
    commit((s) => {
      const cur = s.groupResults[result.nation] || { w: 0, d: 0, l: 0 };
      return { ...s, groupResults: { ...s.groupResults, [result.nation]: { ...cur, [field]: fmt(cur[field]) + 1 } } };
    });
  } else if (result.stage === "ko") {
    commit((s) => {
      const cur = { ...(s.koResults[result.nation] || {}) };
      if (result.won) { cur[result.round] = true; cur.out = false; }
      else { cur.out = true; } // lost this round → locked out, no points for it
      return { ...s, koResults: { ...s.koResults, [result.nation]: cur } };
    });
  }
}

/* ----------------------------- UI SHELL -------------------------- */
function Shell({ children, syncing }) {
  return (
    <div style={S.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;800&family=Archivo+Black&display=swap');
        * { box-sizing: border-box; }
        button { font-family: inherit; cursor: pointer; }
        input { font-family: inherit; }
        @media (prefers-reduced-motion: no-preference){
          .fwc-sync { animation: pulse 1.2s ease-in-out infinite; }
        }
        @keyframes pulse { 0%,100%{opacity:.4} 50%{opacity:1} }
      `}</style>
      <header style={S.header}>
        <div style={S.kicker}>FANTASY · WORLD CUP 2026</div>
        {syncing && <span className="fwc-sync" style={S.sync}>syncing</span>}
      </header>
      <main style={S.main}>{children}</main>
      <footer style={S.footer}>One link · everyone edits · standings update live</footer>
    </div>
  );
}
function Hero({ sub }) {
  return (
    <div style={S.heroWrap}>
      <h1 style={S.heroTitle}>YOUR TEAM<br />OF NATIONS</h1>
      <p style={S.heroSub}>{sub}</p>
    </div>
  );
}
function Card({ title, children }) {
  return (
    <section style={S.card}>
      {title && <h2 style={S.cardTitle}>{title}</h2>}
      {children}
    </section>
  );
}

/* ------------------------------ STYLES --------------------------- */
const ink = "#0B132B", paper = "#F2EFE6", line = "#D8D3C4";
const accent = "#E63946", gold = "#E9B949", deep = "#1C2541";
const S = {
  page: { minHeight: "100%", background: paper, color: ink, fontFamily: "Archivo, system-ui, sans-serif", paddingBottom: 40 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 20px", borderBottom: `2px solid ${ink}` },
  kicker: { fontWeight: 800, letterSpacing: "0.18em", fontSize: 12 },
  sync: { fontSize: 11, color: accent, letterSpacing: "0.1em", textTransform: "uppercase" },
  main: { maxWidth: 760, margin: "0 auto", padding: "20px 16px" },
  footer: { textAlign: "center", fontSize: 11, color: "#8a8676", padding: "20px", letterSpacing: "0.05em" },

  heroWrap: { padding: "8px 4px 22px" },
  heroTitle: { fontFamily: "'Archivo Black', sans-serif", fontSize: "clamp(40px,11vw,72px)", lineHeight: 0.92, margin: 0, letterSpacing: "-0.02em" },
  heroSub: { fontSize: 15, color: deep, maxWidth: 420, marginTop: 14 },

  card: { background: "#fff", border: `2px solid ${ink}`, borderRadius: 4, padding: 18, marginBottom: 16, boxShadow: `5px 5px 0 ${ink}` },
  cardTitle: { fontSize: 13, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", margin: "0 0 14px", color: deep },

  row: { display: "flex", gap: 8, flexWrap: "wrap" },
  note: { fontSize: 13, color: "#6b6857", margin: "4px 0 0" },
  muted: { fontSize: 12, color: "#8a8676" },

  pill: { padding: "10px 14px", border: `2px solid ${ink}`, background: "#fff", borderRadius: 3, fontWeight: 600, fontSize: 14 },
  pillOn: { padding: "10px 14px", border: `2px solid ${ink}`, background: ink, color: "#fff", borderRadius: 3, fontWeight: 700, fontSize: 14 },

  input: { display: "block", width: "100%", padding: "12px 14px", border: `2px solid ${line}`, borderRadius: 3, fontSize: 15, marginBottom: 8 },

  primary: { marginTop: 16, padding: "13px 18px", background: accent, color: "#fff", border: `2px solid ${ink}`, borderRadius: 3, fontWeight: 800, fontSize: 15, width: "100%" },
  primaryOff: { marginTop: 16, padding: "13px 18px", background: "#ccc", color: "#fff", border: `2px solid ${line}`, borderRadius: 3, fontWeight: 800, fontSize: 15, width: "100%", cursor: "not-allowed" },
  ghost: { padding: "13px 18px", background: "#fff", border: `2px solid ${ink}`, borderRadius: 3, fontWeight: 700, fontSize: 15, flex: 1 },
  ghostSm: { padding: "6px 10px", background: "#fff", border: `2px solid ${ink}`, borderRadius: 3, fontWeight: 700 },

  orderRow: { display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${line}` },
  orderNum: { width: 26, height: 26, borderRadius: "50%", background: deep, color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 13 },

  clock: { background: deep, color: "#fff", border: `2px solid ${ink}`, borderRadius: 4, padding: 18, marginBottom: 16, boxShadow: `5px 5px 0 ${ink}` },
  clockName: { fontFamily: "'Archivo Black', sans-serif", fontSize: 30, lineHeight: 1, marginTop: 4 },
  upcoming: { fontSize: 12, color: gold, marginTop: 8, letterSpacing: "0.04em" },

  nationGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(120px,1fr))", gap: 8 },
  nationFree: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, padding: "10px 12px", background: "#fff", border: `2px solid ${ink}`, borderRadius: 3, fontWeight: 600, fontSize: 13, textAlign: "left" },
  nationTaken: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, padding: "10px 12px", background: "#efece2", border: `2px solid ${line}`, borderRadius: 3, fontWeight: 600, fontSize: 13, color: "#9a9684", textAlign: "left", cursor: "not-allowed" },
  ownerTag: { fontSize: 10, color: accent, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" },

  rosterWrap: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 10 },
  rosterCol: { border: `1px solid ${line}`, borderRadius: 3, padding: 8 },
  rosterHead: { fontWeight: 800, fontSize: 13, borderBottom: `2px solid ${ink}`, paddingBottom: 4, marginBottom: 6 },
  rosterTeam: { fontSize: 12, padding: "2px 0" },

  tabs: { display: "flex", gap: 6, marginBottom: 16 },
  tab: { flex: 1, padding: "11px 8px", background: "#fff", border: `2px solid ${ink}`, borderRadius: 3, fontWeight: 700, fontSize: 13 },
  tabOn: { flex: 1, padding: "11px 8px", background: ink, color: "#fff", border: `2px solid ${ink}`, borderRadius: 3, fontWeight: 800, fontSize: 13 },

  standRow: { display: "flex", alignItems: "center", gap: 10, padding: "12px 0", borderBottom: `1px solid ${line}` },
  rank: { width: 24, fontFamily: "'Archivo Black', sans-serif", fontSize: 18, color: deep },
  breakdown: { fontSize: 11, color: "#8a8676" },
  totalPts: { fontFamily: "'Archivo Black', sans-serif", fontSize: 22, color: accent, minWidth: 40, textAlign: "right" },

  gsRow: { display: "flex", alignItems: "center", gap: 8, padding: "12px 0", borderBottom: `1px solid ${line}`, flexWrap: "wrap" },
  stepper: { display: "flex", alignItems: "center", border: `2px solid ${ink}`, borderRadius: 3, overflow: "hidden" },
  stepBtn: { width: 30, height: 32, background: "#fff", border: "none", fontWeight: 800, fontSize: 16 },
  stepVal: { minWidth: 38, textAlign: "center", fontWeight: 700, fontSize: 13 },

  koRow: { padding: "12px 0", borderBottom: `1px solid ${line}` },
  koHead: { display: "flex", justifyContent: "space-between", marginBottom: 8 },
  koChips: { display: "flex", gap: 6, flexWrap: "wrap" },
  chip: { padding: "7px 10px", background: "#fff", border: `2px solid ${ink}`, borderRadius: 3, fontWeight: 600, fontSize: 12 },
  chipOn: { padding: "7px 10px", background: gold, border: `2px solid ${ink}`, borderRadius: 3, fontWeight: 800, fontSize: 12 },
  chipLocked: { padding: "7px 10px", background: "#efece2", border: `2px dashed ${line}`, borderRadius: 3, fontWeight: 600, fontSize: 12, color: "#b4b0a0", cursor: "not-allowed" },
  outTag: { color: accent, fontWeight: 800, fontSize: 11, letterSpacing: "0.06em" },
  outBtn: { padding: "7px 10px", background: "#fff", border: `2px solid ${line}`, borderRadius: 3, fontWeight: 700, fontSize: 12, color: "#6b6857", marginLeft: "auto" },
  outBtnOn: { padding: "7px 10px", background: ink, border: `2px solid ${ink}`, borderRadius: 3, fontWeight: 700, fontSize: 12, color: "#fff", marginLeft: "auto" },
};
