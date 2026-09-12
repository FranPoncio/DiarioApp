import { useState, useEffect, useCallback } from "react";
import {
  traerInvitaciones, crearInvitacion, borrarInvitacion, emailValido,
} from "../lib/gastos";

/* Acá no se manda ningún mail: la invitación es el permiso esperando. El
   invitado entra con su mail por el magic link y la app lo suma al grupo sola.
   Por eso la pantalla insiste con pasarle el link — es el único paso que no
   puede hacer el sistema. */

export default function Invitar({ grupo_id, miembros, onCerrar, onCambio }) {
  const [pendientes, setPendientes] = useState([]);
  const [email, setEmail] = useState("");
  const [alias, setAlias] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [copiado, setCopiado] = useState(false);

  const refrescar = useCallback(async () => {
    try { setPendientes(await traerInvitaciones(grupo_id)); }
    catch (e) { setError(`No se pudieron traer las invitaciones: ${e.message}`); }
  }, [grupo_id]);

  useEffect(() => {
    (async () => { await refrescar(); })();
  }, [refrescar]);

  const invitar = async () => {
    const mail = email.trim().toLowerCase();
    const nombre = alias.trim();
    if (!emailValido(mail)) { setError("Ese mail no parece válido."); return; }
    if (!nombre) { setError("Poné un nombre para mostrar en los gastos."); return; }
    if (pendientes.some((p) => p.email === mail)) {
      setError("Ya invitaste a ese mail y todavía no entró."); return;
    }
    // Los alias son cómo se distingue quién pagó qué: dos iguales vuelven
    // ilegible la tabla del Resumen.
    if (miembros.some((m) => m.alias.toLowerCase() === nombre.toLowerCase())) {
      setError(`Ya hay alguien en el grupo que aparece como ${nombre}.`); return;
    }

    setGuardando(true);
    setError("");
    try {
      await crearInvitacion(grupo_id, { email: mail, alias: nombre });
      setEmail("");
      setAlias("");
      await refrescar();
      await onCambio();
    } catch (e) {
      setError(`No se pudo invitar: ${e.message}`);
    } finally {
      setGuardando(false);
    }
  };

  const cancelar = async (id) => {
    try { await borrarInvitacion(id); await refrescar(); }
    catch (e) { setError(`No se pudo cancelar: ${e.message}`); }
  };

  const copiarLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sin permiso de portapapeles no vale la pena un cartel de error: el
      // link está a la vista abajo y se puede copiar a mano.
    }
  };

  return (
    <div className="sheet-fondo" onClick={onCerrar}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-asa" />
        <h2 className="hoy-tit">Invitar</h2>
        {error && <p className="error banda">{error}</p>}

        <div className="invitar-form">
          <label htmlFor="inv-mail">Mail</label>
          <input id="inv-mail" type="email" inputMode="email" autoComplete="off"
            value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="alguien@mail.com" />

          <label htmlFor="inv-alias">Cómo aparece en los gastos</label>
          <input id="inv-alias" value={alias} onChange={(e) => setAlias(e.target.value)}
            placeholder="Nombre" onKeyDown={(e) => e.key === "Enter" && invitar()} />

          <button className="btn" onClick={invitar}
            disabled={guardando || !email.trim() || !alias.trim()}>
            {guardando ? "Invitando…" : "Invitar"}
          </button>
        </div>

        {pendientes.length > 0 && (
          <div className="invitados">
            <p className="etiqueta">Esperando que entren</p>
            {pendientes.map((p) => (
              <div key={p.id} className="invitado-fila">
                <span className="invitado-txt">
                  {p.alias}
                  <span className="chico"> · {p.email}</span>
                </span>
                <button className="link borrar" onClick={() => cancelar(p.id)}>Cancelar</button>
              </div>
            ))}
          </div>
        )}

        <div className="invitar-nota">
          <p className="chico">
            No mandamos ningún mail. Pasale este link y que entre con el mismo
            mail que invitaste — queda dentro del grupo sola.
          </p>
          <button className="link" onClick={copiarLink}>
            {copiado ? "¡Copiado!" : `Copiar ${window.location.host}`}
          </button>
        </div>
      </div>
    </div>
  );
}
