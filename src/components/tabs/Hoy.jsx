import { useState, useEffect, useCallback, useMemo } from "react";
import {
  traerGastos, traerSaldosPorPar, rubroDe, recurrentesFaltantes, cargarRecurrentes,
  deudasDe, textoSaldo,
} from "../../lib/gastos";
import {
  traerGrupo, traerTareas, actualizarTarea, borrarTarea, escucharPlan, porCercania,
} from "../../lib/tareas";
import { plata, fechaCorta, hoyISO, rangoMes, hoy, parseISO, difDias } from "../../lib/formato";
import { useDeshacer } from "../../lib/deshacer";
import TarjetaTarea from "../TarjetaTarea";
import Toast from "../Toast";
import RubroAvatar from "../RubroAvatar";

export default function Hoy({ contexto, onIrA, onCargarGasto }) {
  const { grupo_id, miembros, yo, rubros } = contexto;
  const [tareas, setTareas] = useState([]);
  const [gastos, setGastos] = useState([]);
  const [pares, setPares] = useState([]);
  const [fijos, setFijos] = useState([]);
  const [fechaLlegada, setFechaLlegada] = useState(null);
  const [listo, setListo] = useState(false);
  const [error, setError] = useState("");
  const { pendiente, pedir, deshacer } = useDeshacer();

  const refrescar = useCallback(async () => {
    try {
      const g = await traerGrupo(grupo_id);
      const n = new Date();
      const [t, gs, s, f] = await Promise.all([
        g.fecha_llegada ? traerTareas(grupo_id) : Promise.resolve([]),
        traerGastos(grupo_id, { limite: 10 }),
        traerSaldosPorPar(grupo_id),
        recurrentesFaltantes(grupo_id, rangoMes(n.getFullYear(), n.getMonth())),
      ]);
      setTareas(t);
      setGastos(gs);
      setPares(s);
      setFijos(f);
      setFechaLlegada(g.fecha_llegada);
      setError("");
    } catch (e) {
      setError(`No se pudo cargar: ${e.message}`);
    } finally {
      setListo(true);
    }
  }, [grupo_id]);

  const ponerFijos = async () => {
    try {
      await cargarRecurrentes(fijos, hoyISO());
      await refrescar();
    } catch (e) { setError(`No se pudieron cargar los fijos: ${e.message}`); }
  };

  useEffect(() => {
    (async () => { await refrescar(); })();
  }, [refrescar]);

  useEffect(() => {
    const cortar = escucharPlan(grupo_id, async () => setTareas(await traerTareas(grupo_id)));
    return cortar;
  }, [grupo_id]);

  const cambiarEstado = async (id, estado) => {
    const anterior = tareas;
    setTareas((prev) => prev.map((t) => (t.id === id ? { ...t, estado } : t)));
    try { await actualizarTarea(id, { estado }); }
    catch (e) { setTareas(anterior); setError(`No se pudo actualizar: ${e.message}`); }
  };

  const eliminar = (id) => {
    pedir({
      mensaje: "Tarea borrada",
      quitar: () => setTareas((prev) => prev.filter((t) => t.id !== id)),
      restaurar: refrescar,
      confirmar: async () => {
        try { await borrarTarea(id); }
        catch (e) { setError(`No se pudo borrar: ${e.message}`); }
      },
    });
  };

  const urgentes = useMemo(() => {
    const pendientes = tareas.filter((t) => t.estado !== "realizada");
    const bloques = porCercania(pendientes);
    return {
      atrasadas: bloques.find((b) => b.id === "atrasadas").items,
      semana: bloques.find((b) => b.id === "semana").items,
    };
  }, [tareas]);

  const deudas = useMemo(
    () => deudasDe(pares, yo?.user_id, miembros),
    [pares, yo?.user_id, miembros]
  );
  const resumen = textoSaldo(deudas, miembros.length > 1);

  const ultimos = gastos.slice(0, 3);
  const alias = (id) => miembros.find((m) => m.user_id === id)?.alias || "?";

  if (!listo) return <div className="cargando">Cargando…</div>;

  const sinUrgentes = urgentes.atrasadas.length === 0 && urgentes.semana.length === 0;

  const diasViaje = fechaLlegada ? difDias(parseISO(fechaLlegada), hoy()) : null;
  const hechas = tareas.filter((t) => t.estado === "realizada").length;
  const progreso = tareas.length ? Math.round((hechas / tareas.length) * 100) : 0;

  return (
    <div className="tab-hoy">
      {error && <p className="error banda">{error}</p>}

      <button className={`saldo-hoy ${resumen.tono} ${resumen.monto == null ? "compacto" : ""}`}
        onClick={() => onIrA("gastos")}>
        <span className="saldo-hoy-lbl">{resumen.texto}</span>
        {resumen.monto != null && <span className="saldo-hoy-n">${plata(resumen.monto)}</span>}
      </button>

      {(diasViaje !== null || tareas.length > 0) && (
        <div className="stats-hoy">
          {diasViaje !== null && (
            <div className="stat-mini">
              <p className="stat-mini-n">{diasViaje > 0 ? diasViaje : diasViaje === 0 ? "¡Hoy!" : Math.abs(diasViaje)}</p>
              <p className="stat-mini-lbl">
                {diasViaje > 0 ? "días para viajar" : diasViaje === 0 ? "es el día" : "días viviendo allá"}
              </p>
            </div>
          )}
          {tareas.length > 0 && (
            <div className="stat-mini">
              <p className="stat-mini-n">{progreso}%</p>
              <p className="stat-mini-lbl">del plan · {hechas}/{tareas.length}</p>
            </div>
          )}
        </div>
      )}

      <button className="accion-rapida" onClick={onCargarGasto}>+ Cargar gasto</button>

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

      {urgentes.atrasadas.length > 0 && (
        <section className="hoy-bloque">
          <h2 className="hoy-tit atrasado">Atrasadas ({urgentes.atrasadas.length})</h2>
          {urgentes.atrasadas.map((t) => (
            <TarjetaTarea key={t.id} tarea={t} compacta
              onCambiarEstado={cambiarEstado} onBorrar={eliminar} />
          ))}
        </section>
      )}

      {urgentes.semana.length > 0 && (
        <section className="hoy-bloque">
          <h2 className="hoy-tit">Esta semana ({urgentes.semana.length})</h2>
          {urgentes.semana.map((t) => (
            <TarjetaTarea key={t.id} tarea={t} compacta
              onCambiarEstado={cambiarEstado} onBorrar={eliminar} />
          ))}
        </section>
      )}

      {sinUrgentes && (
        <p className="vacio">Nada urgente por ahora. Todo en orden.</p>
      )}

      {ultimos.length > 0 && (
        <section className="hoy-bloque">
          <h2 className="hoy-tit">Últimos gastos</h2>
          {ultimos.map((g) => {
            const info = rubroDe(g.rubro, rubros);
            return (
              <article key={g.id} className="gasto" onClick={() => onIrA("gastos")}>
                <RubroAvatar rubro={info} />
                <div className="gasto-txt">
                  <p className="gasto-d">{g.descripcion}</p>
                  <p className="gasto-m">
                    {fechaCorta(g.fecha)} · {g.pagador_id === yo.user_id ? "vos" : alias(g.pagador_id)}
                  </p>
                </div>
                <span className="gasto-n">{plata(g.monto_base)}</span>
              </article>
            );
          })}
        </section>
      )}

      {pendiente && <Toast mensaje={pendiente.mensaje} onDeshacer={deshacer} />}
    </div>
  );
}
