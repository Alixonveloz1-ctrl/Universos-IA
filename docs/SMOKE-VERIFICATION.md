# Verificación real — Fases 1 y 2 (sin gasto hasta autorización explícita)

Este protocolo prepara, no ejecuta, las generaciones de pago. No se inicia
ninguna imagen, video ni ensamblado pagado sin autorización explícita del
propietario para ese lote concreto. No se comparten secretos en el chat.

## Prechequeos sin gasto

1. Vercel: tu proyecto de la app, despliegue de producción desde main en
   READY, con la rama de los cambios de calidad ya mezclada.
2. Variables en Vercel, solo nombres, nunca valores: GCP_PROJECT_ID,
   GCS_OUTPUT_BUCKET, GCS_PREFIX, FIRESTORE_DATABASE_ID,
   CLOUD_RUN_JOB_RESOURCE, APP_ORIGIN, APP_PASSWORD o APP_PASSWORD_HASH,
   SESSION_SECRET, GCP_SERVICE_ACCOUNT_EMAIL, GCP_WIF_AUDIENCE,
   DIRECTOR_MODEL, IMAGE_MODEL, VIDEO_MODEL, MAX_ACTIVE_JOBS.
3. APP_ORIGIN debe ser exactamente el dominio por el que se entra a la app.
   Si se entra por otro dominio de Vercel, el control de origen rechazará
   las peticiones. Decidir un único dominio canónico antes del smoke.
4. Google Cloud: proyecto, bucket privado con el prefijo de la app,
   Firestore Native, y un único Cloud Run Job del worker con la etiqueta
   de flujo correspondiente. No ejecutar `install.sh`, `./s` ni `./d`
   durante la verificación salvo que el prechequeo falle y el propietario
   lo autorice.
5. Login: entrar con la clave, comprobar sesión, y comprobar que una
   petición sin sesión devuelve 401. No probar con la contraseña en el chat.

## Fase 1 — Smoke barato

Orden, y no avanzar si un paso falla:

1. Una imagen canónica de personaje. Pasa si es 9:16, un solo personaje
   de cuerpo completo, sin extremidades extra, con el material y el
   vestuario aprobados.
2. Un video directo de 8 segundos desde esa imagen, con audio nativo.
   Pasa si ffprobe muestra duración cercana a 8 s, 9:16, pista de audio,
   diálogo literal sin prisa ni voces mezcladas, y el hablante es el
   personaje visible correcto.
3. Registrar: modelo usado, ID de operación, duración, costo aproximado
   según la consola de Google, y cualquier código de error del proveedor.
   Si el proveedor rechaza, no reintentar automáticamente: guardar el
   código y el mensaje exactos y reparar la causa (WIF/IAM, bucket,
   modelo, origen, prompt) en ese orden.

Criterio de parada: si el smoke falla dos veces por la misma causa, no
pasar al capítulo completo.

## Fase 2 — Video completo

### Capítulo Universos, 64 segundos

1. Crear y aprobar, en orden: ideas, historia, biblia, referencias
   canónicas, guion de 8 clips.
2. Por cada clip, antes de aprobar el video, comprobar: el estado de
   entrada es el estado final del clip anterior, no aparece ningún
   personaje, objeto ni lugar nuevo que no esté en el guion, el diálogo
   total del clip es de 14 a 21 palabras orientativas, ningún turno
   supera 3 palabras por segundo, hay al menos 0,2 s entre turnos, y la
   acción del clip es una fase de una única acción continua.
3. Ensamblar solo los 8 clips aprobados. Pasa si el MP4 final dura
   cerca de 64 s, se reproduce en iPhone, y sigue disponible después
   de un redeploy.
4. Cerrar el teléfono durante un trabajo en curso y reabrir después:
   el trabajo debe poder reanudarse o recuperarse sin pagar dos veces
   por la misma operación.

### Cinemático, 30 segundos

Solo después de que el capítulo de 64 s pase. Son 7 tomas
(6 de 4 s y 1 de 6 s). Por cada toma, comprobar: imagen inicial aprobada,
geometría y contactos físicos coherentes, rostro visible solo si está
en la imagen inicial, y video generado solo desde esa imagen.
Ensamblar solo las tomas aprobadas.

## Qué no es un pase

- Un despliegue READY en Vercel.
- Una prueba local o E2E con API simulada.
- Un clip que se genera pero con diálogo apurado, voces intercambiadas,
  personajes que aparecen o desaparecen, o una acción nueva no aprobada.
- Un ensamblado que dura lo correcto pero con audio ausente o con un
  clip fuera de orden.

## Después de la verificación

Actualizar `docs/AUDITORIA.md` con la evidencia real: fecha, modelos,
duraciones medidas con ffprobe, costos registrados y videos revisados
por un humano. Solo entonces declarar una fase como terminada.
