import { useState } from "react";
import { tasaDe, subirRecibo, urlRecibo, actualizarGasto } from "../lib/gastos";
import { hoyISO, colorTexto } from "../lib/formato";

/* Carga en tres toques: monto, rubro, quién pagó. Lo demás está detrás de
   "más opciones". Si recibe `gasto`, edita ese en vez de crear uno nuevo. */

export default function NuevoGasto({ contexto, gasto, onGuardar, onBorrar, onCerrar }) {
  const { grupo_id, miembros, yo, rubros } = contexto;
  const edicion = !!gasto;
  const [monto, setMonto] = useState(gasto ? String(gasto.monto) : "");
  const [rubro, setRubro] = useState(gasto?.rubro || rubros[0]?.id || "otros");
  const [pagador, setPagador] = useState(gasto?.pagador_id || yo.user_id);
  const [descripcion, setDescripcion] = useState(gasto?.descripcion || "");
  // 'mitad' es el nombre viejo de 'parejo'; un gasto cargado antes del cambio
  // todavía lo trae y hay que mostrar ese botón como elegido.
  const [split, setSplit] = useState(
    gasto?.split === "mitad" ? "parejo" : gasto?.split || "parejo"
  );
  const [montoExacto, setMontoExacto] = useState(gasto?.monto_exacto != null ? String(gasto.monto_exacto) : "");
  const [moneda, setMoneda] = useState(gasto?.moneda || "NZD");
  const [tc, setTc] = useState(gasto ? String(gasto.tc_a_base ?? 1) : "1");
  const [fecha, setFecha] = useState(gasto?.fecha || hoyISO());
  const [recurrente, setRecurrente] = useState(!!gasto?.recurrente);
  const [mas, setMas] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [recibo, setRecibo] = useState(gasto?.recibo_path || null);
  const [subiendoRecibo, setSubiendoRecibo] = useState(false);
  const [errorRecibo, setErrorRecibo] = useState("");

  const valido = Number(monto) > 0;

  const guardar = async () => {
    if (!valido || guardando) return;
    setGuardando(true);
    await onGuardar({
      grupo_id,
      fecha,
      descripcion: descripcion.trim() || rubros.find((r) => r.id === rubro)?.nombre || rubro,
      rubro,
      monto: Number(monto),
      moneda,
      tc_a_base: Number(tc) || 1,
      pagador_id: pagador,
      split,
      monto_exacto: split === "exacto" ? Number(montoExacto) || 0 : null,
      recurrente,
    });
    setGuardando(false);
    onCerrar();
  };

  const borrar = () => {
    onBorrar(gasto.id);
    onCerrar();
  };

  const elegirRecibo = async (e) => {
    const archivo = e.target.files[0];
    if (!archivo) return;
    setSubiendoRecibo(true);
    setErrorRecibo("");
    try {
      const path = await subirRecibo(grupo_id, gasto.id, archivo);
      await actualizarGasto(gasto.id, { recibo_path: path });
      setRecibo(path);
    } catch (err) {
      setErrorRecibo(`No se pudo subir la foto: ${err.message}`);
    } finally {
      setSubiendoRecibo(false);
    }
  };

  const verRecibo = async () => {
    setErrorRecibo("");
    try {
      window.open(await urlRecibo(recibo), "_blank", "noopener,noreferrer");
    } catch (err) {
      setErrorRecibo(`No se pudo abrir la foto: ${err.message}`);
    }
  };

  return (
    <div className="sheet-fondo" onClick={onCerrar}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-asa" />

        <div className="campo-monto">
          <span className="signo">{moneda === "NZD" ? "$" : moneda}</span>
          <input type="number" inputMode="decimal" step="0.01" autoFocus
            value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0"
            onKeyDown={(e) => e.key === "Enter" && guardar()} />
        </div>

        <div className="rubros">
          {rubros.map((r) => (
            <button key={r.id}
              className={`rubro ${rubro === r.id ? "on" : ""}`}
              style={rubro === r.id ? { background: r.color, borderColor: r.color, color: colorTexto(r.color) } : {}}
              onClick={() => setRubro(r.id)}>
              {r.nombre}
            </button>
          ))}
        </div>

        <div className="quien">
          <span className="etiqueta">Pagó</span>
          <div className="quien-btns">
            {miembros.map((m) => (
              <button key={m.user_id}
                className={`quien-b ${pagador === m.user_id ? "on" : ""}`}
                onClick={() => setPagador(m.user_id)}>
                {m.alias}
              </button>
            ))}
          </div>
        </div>

        <input className="desc" value={descripcion} onChange={(e) => setDescripcion(e.target.value)}
          placeholder="Descripción (opcional)" />

        {mas && (
          <div className="extra">
            <label>Cómo se divide</label>
            <div className="quien-btns">
              {[
                ["parejo", miembros.length > 2 ? "En partes iguales" : "Mitad"],
                ["propio", "Es de quien pagó"],
                ["exacto", "Monto exacto"],
              ].map(([k, l]) => (
                <button key={k} className={`quien-b ${split === k ? "on" : ""}`} onClick={() => setSplit(k)}>{l}</button>
              ))}
            </div>
            {split === "exacto" && (
              <>
                <label>{miembros.length > 2 ? "Le toca a cada uno de los otros" : "Le toca al otro"}</label>
                <input type="number" inputMode="decimal" value={montoExacto}
                  onChange={(e) => setMontoExacto(e.target.value)} placeholder="0.00" />
              </>
            )}

            <label>Moneda</label>
            <div className="quien-btns">
              {["NZD", "USD", "AUD", "ARS"].map((m) => (
                <button key={m} className={`quien-b ${moneda === m ? "on" : ""}`}
                  onClick={() => { setMoneda(m); setTc(String(tasaDe(m))); }}>{m}</button>
              ))}
            </div>
            {moneda !== "NZD" && (
              <>
                <label>1 {moneda} = ? NZD</label>
                <input type="number" inputMode="decimal" step="0.000001" value={tc}
                  onChange={(e) => setTc(e.target.value)} placeholder="0.00" />
              </>
            )}

            <label>Fecha</label>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />

            <button className={`fijo ${recurrente ? "on" : ""}`}
              role="switch" aria-checked={recurrente}
              onClick={() => setRecurrente(!recurrente)}>
              <span className="fijo-caja">{recurrente && "✓"}</span>
              <span>
                Se repite todos los meses
                <span className="chico"> · te lo recuerda para cargarlo</span>
              </span>
            </button>
          </div>
        )}

        <button className="link mas" onClick={() => setMas(!mas)}>
          {mas ? "Menos opciones" : "Más opciones"}
        </button>

        {edicion && (
          <div className="recibo">
            <span className="etiqueta">Recibo</span>
            <div className="quien-btns">
              {recibo && (
                <button type="button" className="quien-b" onClick={verRecibo}>Ver foto</button>
              )}
              <label className="quien-b recibo-subir">
                {subiendoRecibo ? "Subiendo…" : recibo ? "Cambiar foto" : "Agregar foto"}
                <input type="file" accept="image/*" capture="environment" hidden
                  onChange={elegirRecibo} disabled={subiendoRecibo} />
              </label>
            </div>
            {errorRecibo && <p className="error">{errorRecibo}</p>}
          </div>
        )}

        <button className="btn" onClick={guardar} disabled={!valido || guardando}>
          {guardando ? "Guardando…" : edicion ? "Guardar cambios" : "Guardar gasto"}
        </button>

        {edicion && (
          <button className="link borrar centrado" onClick={borrar} disabled={guardando}>
            Borrar gasto
          </button>
        )}
      </div>
    </div>
  );
}