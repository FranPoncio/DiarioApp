import { useState, useEffect } from "react";
import { supabase } from "./lib/supabase";
import { traerContexto } from "./lib/gastos";
import Login from "./components/Login";
import TabBar from "./components/TabBar";
import Hoy from "./components/tabs/Hoy";
import Gastos from "./components/tabs/Gastos";
import Planning from "./components/tabs/Planning";
import Resumen from "./components/tabs/Resumen";
import "./styles.css";

/* Atajo de la PWA ("Cargar gasto" al mantener presionado el ícono, ver
   manifest.webmanifest): entra directo al formulario, sin pasar por Hoy. */
const accesoDirectoGasto = new URLSearchParams(window.location.search).get("nuevo") === "gasto";

export default function App() {
  const [sesion, setSesion] = useState(undefined);
  const [ctx, setCtx] = useState(null);
  const [tab, setTab] = useState(accesoDirectoGasto ? "gastos" : "hoy");
  const [pedirNuevoGasto, setPedirNuevoGasto] = useState(accesoDirectoGasto);
  const [error, setError] = useState("");

  useEffect(() => {
    if (accesoDirectoGasto) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  /* `pedirNuevoGasto` solo tiene que estar prendido en el render donde
     Gastos se monta con el sheet ya abierto — cualquier otra navegación
     lo apaga, para no reabrirlo solo si volvés a esa pestaña más tarde. */
  const cambiarTab = (t) => {
    if (t !== "gastos") setPedirNuevoGasto(false);
    setTab(t);
  };

  const irACargarGasto = () => {
    setPedirNuevoGasto(true);
    setTab("gastos");
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSesion(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSesion(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!sesion) return;
    (async () => {
      try {
        const c = await traerContexto();
        setCtx(c);
      } catch (e) {
        setError(e.message);
      }
    })();
  }, [sesion]);

  // Recarga todo el contexto, no sólo los rubros: también lo usa Invitar,
  // porque sumar un miembro cambia entre cuántos se reparten los gastos.
  const recargarContexto = async () => {
    try {
      setCtx(await traerContexto());
    } catch (e) {
      setError(e.message);
    }
  };

  if (sesion === undefined) return <div className="cargando">Abriendo…</div>;
  if (!sesion) return <Login />;

  if (ctx && !ctx.grupo_id) {
    return (
      <div className="cargando">
        Tu usuario todavía no está en ningún grupo.<br />
        <span className="chico">
          Pedile a alguien del grupo que te invite desde Resumen → Invitar, con
          este mismo mail.
        </span>
      </div>
    );
  }
  if (!ctx) return <div className="cargando">Cargando…</div>;
  if (error) return <div className="cargando error">{error}</div>;

  return (
    <div className="app">
      {tab === "hoy" && <Hoy contexto={ctx} onIrA={cambiarTab} onCargarGasto={irACargarGasto} />}
      {tab === "plan" && <Planning contexto={ctx} />}
      {tab === "gastos" && <Gastos contexto={ctx} autoAbrir={pedirNuevoGasto} />}
      {tab === "resumen" && <Resumen contexto={ctx} onRecargarContexto={recargarContexto} />}
      <TabBar tab={tab} onCambiar={cambiarTab} />
    </div>
  );
}
