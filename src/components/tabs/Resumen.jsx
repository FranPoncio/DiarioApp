import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../../lib/supabase";
import { traerGastos, traerSaldosPorPar, rubroDe, deudasDe, textoSaldo } from "../../lib/gastos";
import { plata, MESES_LARGO, rangoMes } from "../../lib/formato";
import { gastosACSV, bajarCSV } from "../../lib/csv";
import EditarRubros from "../EditarRubros";
import Invitar from "../Invitar";

export default function Resumen({ contexto, onRecargarContexto }) {
  const { grupo_id, miembros, rubros } = contexto;
  const [editandoRubros, setEditandoRubros] = useState(false);
  const [invitando, setInvitando] = useState(false);
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth());
  const [modo, setModo] = useState("mes"); // mes | anio | todo
  const [gastos, setGastos] = useState([]);
  const [pares, setPares] = useState([]);
  const [error, setError] = useState("");

  const refrescar = useCallback(async () => {
    try {
      const rango =
        modo === "mes" ? rangoMes(anio, mes)
        : modo === "anio" ? { desde: `${anio}-01-01`, hasta: `${anio}-12-31` }
        : {};
      const [g, s] = await Promise.all([
        traerGastos(grupo_id, rango),
        traerSaldosPorPar(grupo_id),
      ]);
      setGastos(g);
      setPares(s);
      setError("");
    } catch (e) {
      setError(`No se pudieron traer los datos: ${e.message}`);
    }
  }, [grupo_id, anio, mes, modo]);

  useEffect(() => {
    (async () => { await refrescar(); })();
  }, [refrescar]);

  const cambiarMes = (delta) => {
    if (modo === "anio") { setAnio(anio + delta); return; }
    let m = mes + delta, a = anio;
    if (m < 0) { m = 11; a -= 1; }
    if (m > 11) { m = 0; a += 1; }
    setMes(m); setAnio(a);
  };

  const etiquetaPeriodo =
    modo === "mes" ? `${MESES_LARGO[mes]} ${anio}`
    : modo === "anio" ? `Año ${anio}`
    : "Todo el historial";

  const porRubro = useMemo(() => {
    const mapa = new Map();
    gastos.forEach((g) => mapa.set(g.rubro, (mapa.get(g.rubro) || 0) + Number(g.monto_base)));
    return [...mapa.entries()]
      .map(([rubro, total]) => ({ rubro, total, info: rubroDe(rubro, rubros) }))
      .sort((a, b) => b.total - a.total);
  }, [gastos, rubros]);

  const porPersonaRubro = useMemo(() => {
    const mapa = new Map();
    gastos.forEach((g) => {
      if (!mapa.has(g.rubro)) mapa.set(g.rubro, {});
      const fila = mapa.get(g.rubro);
      fila[g.pagador_id] = (fila[g.pagador_id] || 0) + Number(g.monto_base);
    });
    return mapa;
  }, [gastos]);

  const totalGeneral = porRubro.reduce((acc, r) => acc + r.total, 0);
  const totalesPorPersona = miembros.map((m) =>
    gastos.filter((g) => g.pagador_id === m.user_id).reduce((acc, g) => acc + Number(g.monto_base), 0)
  );

  const deudas = deudasDe(pares, contexto.yo?.user_id, miembros);
  const resumen = textoSaldo(deudas, miembros.length > 1);

  const maximo = porRubro.length ? porRubro[0].total : 0;

  const alias = (id) => miembros.find((m) => m.user_id === id)?.alias || "?";
  const exportar = () => {
    const sufijo =
      modo === "mes" ? `${anio}-${String(mes + 1).padStart(2, "0")}`
      : modo === "anio" ? String(anio)
      : "historico";
    bajarCSV(`gastos-${sufijo}.csv`, gastosACSV(gastos, alias, rubros));
  };

  return (
    <div className="tab-resumen">
      <div className="periodo">
        {[["mes", "Mes"], ["anio", "Año"], ["todo", "Todo"]].map(([k, l]) => (
          <button key={k} className={`periodo-b ${modo === k ? "on" : ""}`} onClick={() => setModo(k)}>{l}</button>
        ))}
      </div>

      <nav className="mes-nav">
        {modo !== "todo" && <button className="link" onClick={() => cambiarMes(-1)}>‹</button>}
        <span>{etiquetaPeriodo}</span>
        {modo !== "todo" && <button className="link" onClick={() => cambiarMes(1)}>›</button>}
      </nav>

      {error && <p className="error banda">{error}</p>}

      {totalGeneral === 0 ? (
        <p className="vacio">Sin gastos este período.</p>
      ) : (
        <>
          <div className="barras">
            <p className="barras-tit">Gasto por rubro <span className="chico">· total ${plata(totalGeneral)}</span></p>
            {porRubro.map((r) => (
              <div key={r.rubro} className="barra-fila">
                <span className="barra-nombre">{r.info.nombre}</span>
                <span className="barra-pista">
                  <span className="barra" style={{
                    width: `${maximo > 0 ? (r.total / maximo) * 100 : 0}%`,
                    background: r.info.color,
                  }} />
                </span>
                <span className="barra-monto">{plata(r.total)}</span>
                <span className="barra-pct chico">{((r.total / totalGeneral) * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>

          <div className="tabla-scroll">
            <table className="tabla-resumen">
              <thead>
                <tr>
                  <th>Rubro</th>
                  {miembros.map((m) => <th key={m.user_id}>{m.alias}</th>)}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {porRubro.map((r) => {
                  const fila = porPersonaRubro.get(r.rubro) || {};
                  return (
                    <tr key={r.rubro}>
                      <td>{r.info.nombre}</td>
                      {miembros.map((m) => <td key={m.user_id}>{plata(fila[m.user_id] || 0)}</td>)}
                      <td>{plata(r.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  {totalesPorPersona.map((t, i) => <td key={i}>{plata(t)}</td>)}
                  <td>{plata(totalGeneral)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      <section className={`saldo-mini ${resumen.tono}`}>
        <p className="chico">{resumen.texto}</p>
        {resumen.monto != null && <p className="saldo-mini-n">${plata(resumen.monto)}</p>}
        {deudas.length > 1 && (
          <ul className="deudas-mini">
            {deudas.map((d) => (
              <li key={d.user_id}>
                <span>{d.saldo > 0 ? `${d.alias} te debe` : `Le debés a ${d.alias}`}</span>
                <span className={d.saldo > 0 ? "favor" : "debo"}>${plata(Math.abs(d.saldo))}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {gastos.length > 0 && (
        <div className="exportar">
          <button className="link" onClick={exportar}>
            Descargar CSV ({gastos.length} {gastos.length === 1 ? "gasto" : "gastos"})
          </button>
        </div>
      )}

      <footer className="pie">
        <span className="chico">Sesión de {contexto.yo?.alias}</span>
        <span>
          <button className="link" onClick={() => setEditandoRubros(true)}>Categorías</button>
          {" · "}
          <button className="link" onClick={() => setInvitando(true)}>Invitar</button>
          {" · "}
          <button className="link" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
        </span>
      </footer>

      {editandoRubros && (
        <EditarRubros grupo_id={grupo_id} rubros={rubros}
          onCambio={onRecargarContexto} onCerrar={() => setEditandoRubros(false)} />
      )}

      {invitando && (
        <Invitar grupo_id={grupo_id} miembros={miembros}
          onCambio={onRecargarContexto} onCerrar={() => setInvitando(false)} />
      )}
    </div>
  );
}
