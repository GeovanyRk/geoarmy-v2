# Mi regalo de Navidad — contrato del adaptador (Pin 06, solo presentación)

`navidad-regalo.html` + `js/navidad-regalo.js` + `css/navidad-regalo.css` **solo dibujan** lo que el servidor autoriza.
La página no decide ganadores, no genera resultados aleatorios, no acredita V-Bucks, no escribe en Supabase y no llama a ningún RPC.
Sin datos del servidor queda en estado "sincronizando" con el botón bloqueado.

## API (`window.GeoArmyRegalo`)
| Método | Uso |
|---|---|
| `applyServerData(d)` | Entrega estado autorizado. Se puede llamar varias veces; fusiona los campos presentes. |
| `setOpenHandler(fn)` | `fn()` devuelve `Promise<d>`. El backend ejecuta la apertura (idempotente) y responde con `gift.state='opened'` + `result.authorized=true`. Sin handler el botón no se habilita. La animación solo corre **después** de recibir la respuesta. |
| `setConnectionError(bool)` | `true` si no se pudo consultar al servidor (mensaje; no se inventa estado). |
| `snapshot()` | Copia de solo lectura del estado (pruebas). |

Evento `geoarmy:regalo-refresh` (en `document`): se emite cuando la cuenta regresiva llega a 0; el backend debe responder con `applyServerData`. La página **no** habilita el botón por sí sola al llegar a 0.

## Formato `d`
```
{
  serverNow:  ISO-8601                      // hora oficial del servidor (obligatoria para salir de "sincronizando")
  member:     { loggedIn, displayName, country }   // country: 'MX' | null
  participation: { status: 'participant'|'not_participating'|'unknown' }  // informativo, no revela el resultado
  gift:       { state: 'waiting'|'available'|'opened'|'unavailable', availableAt: ISO|null }
  result:     null | { authorized: true, kind: 'vbucks'|'coal', amount?: 1000 }  // solo con gift.state='opened'
  opened:     null | { at: ISO }
  credit:     null | { status: 'pending'|'credited'|'review'|'not_applicable', at?: ISO }
  message:    null | { body: string }      // carta de Santa; párrafos separados por línea en blanco. Sin ella se usa texto por defecto
  journey:    { tree, workshop, post, list, travel: 'completed'|'pending'|'unknown' }  // opcional
}
```
Reglas de presentación:
- Resultado solo se muestra si `gift.state='opened'` **y** `result.authorized===true`. Nunca antes.
- "Completado" solo si `journey.*==='completed'`; sin dato = "Sin confirmar". Completar actividades **no** es requisito.
- Estados: `waiting` → A (espera, cuenta regresiva a `availableAt`), `available` → B (botón activo), `opened` → E (muestra lo guardado, sin repetir entrega, aviso "No se repite la entrega"). C/D son la secuencia de apertura según `result.kind`.
- `credit` pendiente → "Acreditación pendiente de confirmación del servidor"; `coal` → "Regalo simbólico · no requiere acreditación".

## Vistas previas (simulación)
`?preview=espera|disponible|ganador|carbon|abierto` (+ `&resultado=carbon` para disponible/abierto). Muestran un aviso "VISTA PREVIA DE DISEÑO", no hacen llamadas de red ni operaciones económicas ni registran premios. `ganador` y `carbon` ejecutan la apertura automáticamente (botón "Repetir apertura").

## Publicación
- La pestaña «Mi regalo de Navidad» sigue deshabilitada ("Próximamente") en las demás páginas; solo se resalta en `navidad-regalo.html`. Para activarla públicamente: definir `REGALO_URL` en `js/navidad-nav.js`.
- El pin no está agregado al planeta.

## Assets (assets/navidad/regalo/)
`regalo-tapa.webp` 580×176, `regalo-caja.webp` 580×198, `regalo-nido.webp` 580×88, `vbucks.webp` 314×244, `carbon.webp` 348×247, `lazo.webp` 433×137, `encabezado-cabana.webp` 547×297, `decor-regalo-rojo.webp` / `decor-regalo-verde.webp` 400×267.
Recortes derivados de la imagen de referencia (1672 px); pueden sustituirse por piezas limpias con los mismos nombres y proporción (ideal 2×).
