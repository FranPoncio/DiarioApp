import { useState, useEffect, useCallback, useMemo } from "react";
import {
  traerGastos, traerSaldosPorPar, cargarGasto, borrarGasto, actualizarGasto,
  saldarCuentas, sincronizarCola, cantidadEnCola, escucharCambios, rubroDe,
  recurrentesFaltantes, cargarRecurrentes, deudasDe, textoSaldo,
} from "../../lib/gastos";
import { plata, fechaCorta, hoyISO, rangoMes, sinAcentos, colorTexto } from "../../lib/formato";
import { useDeshacer } from "../../lib/deshacer";
import NuevoGasto from "../NuevoGasto";
import Toast from "../Toast";
import RubroAvatar from "../RubroAvatar";

export default function Gastos({ contexto, autoAbrir = false }) {
  const { grupo_id, miembros, yo, rubros } = contexto;

  const [gastos, setGastos] = useState([]);
  const [pares, setPares] = useState([]);
  const [filtro, setFiltro] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [abrirNuevo, setAbrirNuevo] = useState(autoAbrir);
  const [editando, setEditando] = useState(null);
  const [fijos, setFijos] = useState([]);
  const [enCola, setEnCola] = useState(cantidadEnCola());
  const [error, setError] = useState("");
  const { pendiente, pedir, deshacer } = useDeshacer();

  const refrescar = useCallback(async () => {
    try {
      const n = new Date();
      const [g, s, f] = await Promise.all([
        traerGastos(grupo_id, { limite: 300 }),
        traerSaldosPorPar(grupo_id),
        recurrentesFaltantes(grupo_id, rangoMes(n.getFullYear(), n.getMonth())),
      ]);
      setGastos(g);
      setPares(s);
      setFijos(f);
      setError("");
    } catch {
      setError("No se pudieron traer los datos. Revisá la conexión.");
    }
  }, [grupo_id]);

  const ponerFijos = async () => {
    try {
      await cargarRecurrentes(fijos, hoyISO());
      await refrescar();
    } catch (e) { setError(`No se pudieron cargar los fijos: ${e.message}`); }
  };

  useEffect(() => {
    (async () => {
      await sincronizarCola().then((r) => setEnCola(r.restantes));
      await refrescar();
    })();
  }, [refrescar]);

  useEffect(() => {
    const cortar = escucharCambios(grupo_id, refrescar);
    const alVolver = async () => {
      const r = await sincronizarCola();
      setEnCola(r.restantes);
      refrescar();
    };
    window.addEventListener("online", alVolver);
    return () => { cortar(); window.removeEventListener("online", alVolver); };
  }, [grupo_id, refrescar]);

  const deudas = useMemo(
    () => deudasDe(pares, yo?.user_id, miembros),
    [pares, yo?.user_id, miembros]
  );
  const resumen = textoSaldo(deudas, miembros.length > 1);

  const visibles = useMemo(() => {
    const q = sinAcentos(busqueda.trim());
    return gastos.filter((g) =>
      (!filtro || g.rubro === filtro) && (!q || sinAcentos(g.descripcion).includes(q))
    );
  }, [gastos, filtro, busqueda]);

  const porDia = useMemo(() => {
    const mapa = new Map();
    visibles.forEach((g) => {
      if (!mapa.has(g.fecha)) mapa.set(g.fecha, []);
      mapa.get(g.fecha).push(g);
    });
    return [...mapa.entries()];
  }, [visibles]);

  const alias = (id) => miembros.find((m) => m.user_id === id)?.alias || "?";

  const guardarGasto = async (g) => {
    const { fila, pendiente } = await cargarGasto(g, miembros.length);
    setGastos((prev) => [fila, ...prev]);
    setEnCola(cantidadEnCola());
    if (!pendiente) refrescar();
  };

  const eliminar = (id) => {
    pedir({
      mensaje: "Gasto borrado",
      quitar: () => setGastos((prev) => prev.filter((g) => g.id !== id)),
      restaurar: refrescar,
      confirmar: async () => {
        try { await borrarGasto(id); }
        catch (e) { setError(`No se pudo borrar: ${e.message}`); }
        refrescar();
      },
    });
  };

  const editar = async (cambios) => {
    const id = editando.id;
    const anterior = gastos;
    setGastos((prev) => prev.map((g) => (g.id === id ? { ...g, ...cambios } : g)));
    try { await actualizarGasto(id, cambios); refrescar(); }
    catch (e) { setGastos(anterior); setError(`No se pudo guardar: ${e.message}`); }
  };

  /* Se salda de a una persona: con más de dos, pagar "el neto" le daría de
     más a uno y dejaría al otro sin cobrar. */
  const saldar = async (persona) => {
    const monto = Math.abs(persona.saldo);
    const debo = persona.saldo < 0;
    if (!confirm(debo ? `¿Registrar que le pagaste ${plata(monto)} a ${persona.alias}?`
                      : `¿Registrar que ${persona.alias} te pagó ${plata(monto)}?`)) return;
    try {
      await saldarCuentas({
        grupo_id,
        de_id: debo ? yo.user_id : persona.user_id,
        a_id: debo ? persona.user_id : yo.user_id,
        monto,
      });
      refrescar();
    } catch { setError("No se pudo registrar el pago."); }
  };

  return (
    <div className="tab-gastos">
      <header className={`balance ${resumen.tono}`}>
        <p className="balance-lbl">{resumen.texto}</p>
        {resumen.monto != null && (
          <p className="balance-n">
            <span className="signo">$</span>{plata(resumen.monto)}
          </p>
        )}

        {/* Con dos personas el detalle repetiría el número grande; recién
            suma cuando hay que saber a quién cobrarle. */}
        {deudas.length === 1 && (
          <button className="saldar" onClick={() => saldar(deudas[0])}>Saldar cuentas</button>
        )}
        {deudas.length > 1 && (
          <ul className="deudas">
            {deudas.map((d) => (
              <li key={d.user_id} className={d.saldo > 0 ? "favor" : "debo"}>
                <span className="deuda-quien">
                  {d.saldo > 0 ? `${d.alias} te debe` : `Le debés a ${d.alias}`}
                </span>
                <span className="deuda-n">${plata(Math.abs(d.saldo))}</span>
                <button className="saldar chico" onClick={() => saldar(d)}>Saldar</button>
              </li>
            ))}
          </ul>
        )}

        {enCola > 0 && <p className="cola">{enCola} sin sincronizar</p>}
      </header>

      <div className="buscador">
        <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar gasto…" />
      </div>

      <nav className="filtros">
        <button className={`f ${!filtro ? "on" : ""}`} onClick={() => setFiltro(null)}>Todo</button>
        {[...new Set(gastos.map((g) => g.rubro))].map((r) => {
          const info = rubroDe(r, rubros);
          return (
            <button key={r} className={`f ${filtro === r ? "on" : ""}`}
              style={filtro === r ? { background: info.color, borderColor: info.color, color: colorTexto(info.color) } : {}}
              onClick={() => setFiltro(filtro === r ? null : r)}>
              {info.nombre}
            </button>
          );
        })}
      </nav>

      {error && <p className="error banda">{error}</p>}

      {fijos.length > 0 && (
        <div className="aviso-fijos">
          <span>
            {fijos.length === 1
              ? "Falta cargar 1 gasto fijo de este mes"
              : `Faltan cargar ${fijos.length} gastos fijos de este mes`}
            <span className="chico"> · {fijos.map((f) => f.descripcion).join(", ")}</span>
          </span>
          <button className="link" onClick={ponerFijos}>Cargarlos</button>
        </div>
      )}

      <main className="lista">
        {porDia.length === 0 && <p className="vacio">Todavía no hay gastos. Tocá el + para cargar el primero.</p>}
        {porDia.map(([fecha, items]) => (
          <section key={fecha}>
            <h2 className="dia">{fechaCorta(fecha)}</h2>
            {items.map((g) => {
              const info = rubroDe(g.rubro, rubros);
              const mio = g.pagador_id === yo.user_id;
              return (
                <article key={g.id} className={`gasto ${g.pendiente ? "pend" : ""}`}
                  onClick={() => !g.pendiente && setEditando(g)}>
                  <RubroAvatar rubro={info} />
                  <div className="gasto-txt">
                    <p className="gasto-d">{g.descripcion}</p>
                    <p className="gasto-m">
                      {mio ? "Pagaste vos" : `Pagó ${alias(g.pagador_id)}`}
                      {g.split === "propio" && " · no se divide"}
                      {g.moneda !== "NZD" && ` · ${g.monto} ${g.moneda}`}
                      {g.recibo_path && " · con foto"}
                      {g.pendiente && " · sin sincronizar"}
                    </p>
                  </div>
                  <span className="gasto-n">{plata(g.monto_base)}</span>
                </article>
              );
            })}
          </section>
        ))}
      </main>

      <button className="fab" onClick={() => setAbrirNuevo(true)} aria-label="Cargar gasto">+</button>

      {pendiente && <Toast mensaje={pendiente.mensaje} onDeshacer={deshacer} />}

      {abrirNuevo && (
        <NuevoGasto contexto={contexto} onGuardar={guardarGasto} onCerrar={() => setAbrirNuevo(false)} />
      )}

      {editando && (
        <NuevoGasto contexto={contexto} gasto={editando}
          onGuardar={editar} onBorrar={eliminar} onCerrar={() => setEditando(null)} />
      )}
    </div>
  );
}
