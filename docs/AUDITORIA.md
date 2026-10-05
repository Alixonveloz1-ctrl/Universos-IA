# Auditoría de implementación en desarrollo

## Corrección de alcance — 5 de octubre de 2026

La tabla histórica de abajo refleja el estado y las pruebas de septiembre y no certifica el estado actual. El montaje del flujo de 64 segundos usa copia de streams solo cuando los ocho clips comparten códecs, dimensiones y tiempos; normaliza los incompatibles y valida su resultado. El flujo Cinemático siempre normaliza y valida audio, video y continuidad temporal. Las verificaciones locales y simuladas no acreditan generación real con Google, despliegue en Vercel ni reproducción física en móvil.

## Publicación y preparación de despliegue — 27 de septiembre de 2026

Esta sección sustituye los bloqueos históricos de publicación que figuran más abajo. **El código ya está publicado en main; Vercel y Google Cloud siguen pendientes de instalación y prueba real.**

| Área | Clasificación | Evidencia y alcance |
|---|---|---|
| Código completo en GitHub | IMPLEMENTADO Y VERIFICADO | Commit `2b918a320d5c5a7e09d5c7b7855ce66f61498da0`, árbol `a0832ff35d371bd619ca267081b1d1a9beff7681`, idéntico al checkout verificado. Conserva el commit inicial remoto, sin force. Código recuperado desde e13832a; el historial local anterior permanece en el respaldo recuperado. |
| Portada original | IMPLEMENTADO Y VERIFICADO | Transferida por partes en una rama auxiliar y reconstruida sin cambios; SHA-256 `854a799df45bb91a32131e3afe27463f4959cf66d956ebc44e4482127669d5d8`. main contiene el PNG original, sin fragmentos ni workflow auxiliar. |
| Instalador de un comando | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | `bash install.sh`, configuración privada en terminal, mismo worker con ensamblador/FFmpeg, identidad de compilación separada, comprobaciones de bucket/Firestore/Docker/WIF. Seis regresiones con gcloud SIMULADO pasan. No se ejecutó contra una cuenta Google. |
| 57 pruebas y compilación | IMPLEMENTADO Y VERIFICADO | Lint, TypeScript, sintaxis shell, 57 pruebas y build pasan localmente y en el primer CI remoto. Tres pruebas son FFmpeg REAL sobre archivos SINTÉTICOS; Google y persistencia siguen SIMULADOS. |
| Recorrido completo en navegador | IMPLEMENTADO Y VERIFICADO | Chromium en GitHub completó historia, biblia, referencias, ocho clips secuenciales, exportación y recarga con API SIMULADA. También pasaron el rechazo real del backend sin sesión y el escenario de error del proveedor. No equivale a una prueba Google ni a un iPhone físico. |
| Selector del escenario de creación móvil | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | El primer CI detectó que la búsqueda exacta del label incluía texto de sus opciones. Se corrige el selector y se conserva la comprobación de creación, tres propuestas, selección, recarga y ancho móvil. El resultado de la ejecución de CI del commit actual es la evidencia autoritativa. |
| Vercel y Google Cloud | BLOQUEADO | El propietario debe ejecutar el instalador con sus recursos y configurar/desplegar la web. Sin generaciones pagadas ni prueba real de IAM, OIDC, persistencia o continuidad audiovisual. |

Primer CI: https://github.com/Alixonveloz1-ctrl/Universos-IA/actions/runs/36347551327 . Terminó con tres de cuatro escenarios E2E correctos; su fallo se conserva como evidencia, no se presenta como un CI verde. Consultar la ejecución más reciente en https://github.com/Alixonveloz1-ctrl/Universos-IA/actions . Instrucciones: [INSTALACION.md](INSTALACION.md).

## Evidencia histórica

Estado al 27 de septiembre de 2026. **No terminado, sin despliegue verificado en Vercel ni Google Cloud.** Los valores privados los configurará el propietario; no se requieren en el chat. Esta es una revisión del avance, no certificación de producción.

Las clasificaciones se limitan a las solicitadas. «IMPLEMENTADO Y VERIFICADO» solo cubre la evidencia indicada; pruebas simuladas nunca equivalen a verificación de servicios reales.

| Sección / requisito | Estado | Evidencia o bloqueo |
|---|---|---|
| 1 · Ocho clips de ocho segundos | IMPLEMENTADO Y VERIFICADO | Esquemas y solicitudes; unitarias locales |
| 1 · Audio exclusivamente Veo | IMPLEMENTADO Y VERIFICADO | Contrato generateAudio=true; sin módulos de audio externo |
| 1 · Separar candidato y aprobación | IMPLEMENTADO Y VERIFICADO | Versiones y punteros; transacciones simuladas |
| 1 · Recorrido completo del producto | BLOQUEADO | Faltan ejecución E2E en navegador, despliegue y recorrido real con Google Cloud |
| 2 · Catálogo exacto sin sustitución | IMPLEMENTADO Y VERIFICADO | Registro único y pruebas de rechazo |
| 2 · Ubicaciones por modelo | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | Registro global/us-central1 |
| 2 · Modelos seleccionables al crear historia | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | UI y API; falta validar navegador y proveedor |
| 2 · Cambio explícito de modelo en historia existente | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | Selector de modelos en historia y validación API; historial conserva el modelo original |
| 2 · Modos compatibles y referencias enviadas registradas | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | Imagen inicial implementada; adaptador distingue referencias |
| 3 · Inicio, asistente, historia/biblia/producción/final | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | UI integrada; E2E de navegador no ejecutado |
| 3 · Fidelidad visual a imagen adjunta | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | Arte de portada integrado, paleta, formularios y adaptación móvil; falta inspección visual en navegador |
| 3 · Tres propuestas y regeneración individual | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | Director y API reales; proveedor sin ejecutar |
| 3 · Botones reales por imagen y clip | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | Generar, regenerar, instrucciones, aprobar, versiones y reproducción |
| 3 · Generar pendientes solo por autorización | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | Snapshot del lote; ejecución secuencial |
| 3 · Mensajes españoles y recuperación visible | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | Estados y consulta persistente; falta E2E completo |
| 4 · Catálogo narrativo separado de tipo de ser | IMPLEMENTADO Y VERIFICADO | Datos versionados y validación API |
| 4 · Exactamente tres tarjetas distintas | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | Cantidad determinista; diversidad editorial requiere revisión humana |
| 5 · Director único por etapa | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | Módulo único y plantillas; sin framework multiagente |
| 5 · Investigación editorial identificada | IMPLEMENTADO Y VERIFICADO | docs/EDITORIAL.md, fuentes consultadas y distinción de inferencias |
| 5 · Máximo una reparación de JSON | IMPLEMENTADO Y VERIFICADO | Prueba simulada verifica presupuesto compartido con reparación editorial y ausencia de repetición por respuesta perdida |
| 5 · Revisión semántica completa de continuidad | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | Mismo proveedor de texto, errores/propuestas, checkpoint y presupuesto único de reparación; pruebas simuladas |
| 6 · Universo snapshot por historia | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | Persistencia y copia versionada |
| 6 · Fichas, voces descriptivas, escenarios y estado | IMPLEMENTADO Y VERIFICADO | Esquemas y fixtures validados localmente |
| 6 · Estado observado separado del previsto | IMPLEMENTADO Y VERIFICADO | Prompt utiliza observado anterior; prueba local |
| 6 · Edición completa de biblia y listas | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | Altas/bajas, selección de personajes/escenarios, validación frontend/backend y revisión base del borrador |
| 7 · Guion completo, tiempos locales y varias tomas | IMPLEMENTADO Y VERIFICADO | Ocho clips, IDs, cobertura temporal y hablantes validados |
| 7 · Diálogo y acento reales consistentes | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | Prompts conservan literal y perfiles; requiere escuchar Veo |
| 8 · Referencias canónicas e imagen por toma | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | Targets separados y llamadas Gemini con bytes de referencia |
| 8 · 9:16, MIME real, resolución y persistencia previa | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | Parámetros y Sharp; no imagen real generada |
| 8 · Fotograma previo compatible | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | Extracción FFmpeg y elección según plan |
| 8 · Imagen cambia solo dependencias sin regenerar | IMPLEMENTADO Y VERIFICADO | Regresión de toma secundaria; pruebas locales |
| 9 · Solicitud nativa de video y audio | IMPLEMENTADO Y VERIFICADO | Unitarias de contrato y catálogo |
| 9 · Clip real reproducible con audio y 8 segundos | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | Adaptador/ffprobe escritos; ningún smoke Google ejecutado |
| 10 · Versiones inmutables y restauración por selección | IMPLEMENTADO Y VERIFICADO | Asset anterior conservado; prueba con store simulado |
| 10 · Cambio local de diálogo | IMPLEMENTADO Y VERIFICADO | Regresión: solo clip cambiado queda pendiente |
| 10 · Exportación congelada ante carrera | IMPLEMENTADO Y VERIFICADO | Prueba transaccional simulada; manifiesto inmutable |
| 11 · Una app y un ejecutor | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | Next.js, contenedor y dispatch; sin despliegue |
| 11 · URLs firmadas y bucket privado | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | Código y configuración de instalación; permisos sin validar |
| 12 · Entidades/subcolecciones y validaciones backend | IMPLEMENTADO Y VERIFICADO | Esquemas y pruebas de transacciones simuladas |
| 12 · Durabilidad real Firestore y GCS | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | No se usan memoria/localStorage como persistencia de producción |
| 13 · Cookie segura, hash y CSRF | IMPLEMENTADO Y VERIFICADO | Pruebas locales de sesión, firma, expiración y origen |
| 13 · Límite persistente de acceso | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | Transacción Firestore de intentos, no validada en nube |
| 13 · Identidades separadas y OIDC/WIF | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | Sin claves en cliente; instalador sin ejecutar |
| 13 · Tamaños, pertenencia, rutas y origen | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | Controles backend presentes; falta auditoría dinámica completa |
| 14 · Idempotencia y doble envío | IMPLEMENTADO Y VERIFICADO | Simulador serializa llamadas concurrentes; misma intención recupera job |
| 14 · Lease, heartbeat, límites y reanudación Veo | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | Worker escrito; falta reinicio real de Cloud Run |
| 14 · No repetir consumo por timeout ambiguo | IMPLEMENTADO Y VERIFICADO | Barrera y regresión simulada |
| 14 · Reconciliar ambigüedad sin bloquear proyecto indefinidamente | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | Recupera checkpoints, objetos de imagen y MP4 del intento; cierre auditado requiere reconciliación y reconocimiento expreso. Simulación de reinicio tras upload pasa |
| 14 · Detener lote sin borrar medios | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | Worker comprueba stop; operación ya enviada se conserva |
| 14 · Errores concretos de proveedor | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | Códigos sin fallback; revisar mensajes usando respuestas reales |
| 15 · Concatenación real sin música externa | IMPLEMENTADO Y VERIFICADO | FFmpeg local: ocho MP4 sintéticos con audio, 64 s nominales |
| 15 · Normalización de streams incompatibles | IMPLEMENTADO Y VERIFICADO | FFmpeg real local, fuentes sintéticas 24/30 fps, ocho colores y tonos identificables; corrección de frames duplicados |
| 15 · Orden visual, sincronía y reproducción móvil | BLOQUEADO | Orden de colores/tonos, duración de audio y huecos entre paquetes verificados localmente; reproducción móvil todavía sin verificar |
| 15 · MP4 y reporte persistentes | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | Uploads y registro al finalizar; GCS sin ejecutar |
| 16 · Repositorio local independiente | IMPLEMENTADO Y VERIFICADO | Directorio propio y git local, sin modificar otros repositorios |
| 16 · Repositorio GitHub nuevo del propietario | IMPLEMENTADO Y VERIFICADO | Repositorio creado por el propietario: Alixonveloz1-ctrl/Universos-IA. Lectura mediante Git confirmada; commit inicial cb4dceb conservado |
| 16 · Publicar código en main | BLOQUEADO | Git pudo leer el remoto y conservar su commit inicial, pero push falló por falta de autenticación de escritura; el complemento devuelve Unknown tool |
| 16 · Instalador reproducible | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | bash -n pasa; gcloud no ejecutado, revisión IAM/idempotencia real pendiente |
| 16 · Producción en Vercel desde main | BLOQUEADO | Repositorio remoto identificado; destino Vercel todavía pendiente. La revisión automática rechazó la llamada de despliegue sin proyecto/cuenta/configuración acotados; no se ejecutó |
| 17 · Incrementos, CI, lockfile y documentación | IMPLEMENTADO Y VERIFICADO | Lint, typecheck, 43 pruebas y build locales pasan; CI remoto sin ejecutar |
| 18 · E2E completo de UI | BLOQUEADO | Escenarios de interfaz escritos sin acreditar ejecución. Chromium local no disponible y navegador remoto rechaza 127.0.0.1 con ERR_BLOCKED_BY_CLIENT |
| 18 · Smoke real de imagen y video | BLOQUEADO | Entorno privado no configurado aquí; sin consumo ni resultados reales |
| 18 · Ocho clips reales y redeploy persistente | BLOQUEADO | Requiere instalación y autorización de generaciones reales del propietario |
| 19 · Precedencia y fuentes | IMPLEMENTADO Y VERIFICADO | V2 conservada como contrato; referencias en docs/INTEGRACIONES.md |
| 6 · Editor de universos reutilizables | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | UI PATCH con revisión; no altera snapshots de historias existentes |
| 8 · Límites de referencias por modelo | IMPLEMENTADO Y VERIFICADO | Registro 3/14 imágenes, 7 MiB por referencia inline, toma usa personajes/escenario por ID; regresión local |
| 8 · Extraer exactamente el último fotograma | IMPLEMENTADO Y VERIFICADO | FFmpeg real local: último frame rojo, anteriores azules; regresión del método de búsqueda temporal |
| 14 · Checkpoints extensos sin superar documento Firestore | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | Subcolección de resultados y referencias pequeñas en job; worker probado con store simulado |
| 14 · Despachos tardíos y recuperación concurrente | IMPLEMENTADO Y VERIFICADO | Worker completo ejecutado con proveedores simulados: un lease, una llamada y rechazo de trabajo detenido/sustituido |

## Evidencia heredada del paquete original

`npm run lint`, `npm run typecheck`, `npm test` (43 pruebas), `npm run build` y `bash -n scripts/setup-gcp.sh` pasaron. Las pruebas de store usan un simulador en memoria únicamente dentro de tests. La prueba FFmpeg ejecuta binarios reales, pero sus archivos son sintéticos. No hay prueba de integración real con Google Cloud ni afirmación de despliegue.

La descarga de Chromium mediante Playwright falló por archivo ZIP vacío o incompleto. Los tres escenarios de interfaz no se han acreditado como ejecutados. Este hecho no justifica considerar la aplicación terminada.

También pasó una prueba HTTP contra el backend local real: GET /api/projects sin sesión devuelve 401. No usa el navegador ni acredita los tres escenarios de interfaz simulada.

## Límites de la evidencia

Los 43 tests locales incluyen proveedores y persistencia **SIMULADOS**, y tres integraciones **REALES LOCALES** con FFmpeg usando medios **SINTÉTICOS**. No se ha ejecutado ninguna generación real de Google Cloud. La portada estática se creó con la herramienta de imágenes durante la implementación; no se presenta como resultado generado por la aplicación ni como prueba de Gemini/Veo.

El cierre de un intento ambiguo no cancela al proveedor ni promete devolver créditos. Conserva la solicitud y su posible consumo, exige comprobar recuperación y deja cualquier nueva generación como acción explícita independiente.


## Continuación verificada el 27 de septiembre de 2026

Se leyó íntegramente el DOCX V2 original, incluidas sus 19 secciones, tablas, encabezado y pie, y todos los documentos de traspaso. Los 60 archivos del manifiesto SHA-256 coinciden. Se restauró el historial desde el bundle y se confirmó que el remoto autorizado conserva el commit inicial cb4dceb.

Esta sección actualiza la evidencia heredada anterior; no presenta aquella sesión como trabajo ejecutado ahora.

| Requisito / hallazgo | Clasificación | Evidencia actual |
|---|---|---|
| Acceso mediante complemento GitHub | IMPLEMENTADO Y VERIFICADO | Perfil Alixonveloz1-ctrl y metadatos de Alixonveloz1-ctrl/Universos-IA, con pull/push permitidos. El error Unknown tool de la sesión anterior ya no se reproduce. Git por HTTPS sigue sin autenticación de escritura; se publica por el complemento. |
| Controles locales | IMPLEMENTADO Y VERIFICADO | npm ci, lint, typecheck, 51 pruebas, build de producción y bash -n ejecutados en esta continuación. Tres pruebas usan FFmpeg real con medios sintéticos; el resto usa lógica local o proveedores/persistencia simulados. |
| Operación de video aún pendiente tras fallo local | IMPLEMENTADO Y VERIFICADO | Regresiones simuladas bloquean otra generación con operación sin resultado, incluso con estado failed/stopped. La reanudación conserva el ID; una respuesta terminal de error queda registrada antes de permitir una petición explícita nueva. |
| Exclusión mientras el ejecutor mantiene lease | IMPLEMENTADO Y VERIFICADO | Regresión simulada impide sustituir un trabajo con lease activo aunque su estado local sea failed. |
| Respuesta tardía de un ejecutor desplazado | IMPLEMENTADO Y VERIFICADO | Checkpoints, candidatas y publicación del manifiesto se escriben bajo comprobación transaccional del lease. Regresión simulada demuestra que la respuesta tardía no sobrescribe un checkpoint. |
| Referencia canónica modificada | IMPLEMENTADO Y VERIFICADO | La invalidación alcanza storyboard dependiente y su clip, incluidos planos secundarios. Regresión simulada conserva los clips ajenos y todos los archivos anteriores. |
| Reaprobación sin cambios | IMPLEMENTADO Y VERIFICADO | Mismo video y mismo estado observado no invalidan el siguiente clip; un cambio de estado sí conserva la revisión de continuidad. |
| Restauración narrativa junto con selección | IMPLEMENTADO Y VERIFICADO | Lecturas transaccionales preceden escrituras; regresión con simulador que rechaza lecturas posteriores a escrituras. |
| Editor, medios y puerta de exportación | IMPLEMENTADO, PENDIENTE DE PRUEBA REAL | El borrador se limpia solo tras guardar correctamente; una renovación de URL exitosa limpia errores transitorios; la UI de exportación usa las mismas precondiciones del backend. Typecheck/build verificados, navegador pendiente. |
| Navegador local | BLOQUEADO | Playwright no pudo instalar Chromium: la descarga terminó vacía/incompleta. No equivale a un fallo probado de la aplicación. E2E remoto pendiente. |
| Destino Vercel | BLOQUEADO | list_teams devuelve teams=[] en esta conexión. No se obtuvo un equipo o proyecto verificable de Universos IA; no se inventó ni seleccionó un destino ajeno. |
| Google Cloud y recorrido pagado | BLOQUEADO | No hay configuración de destino Google Cloud autorizada disponible en esta sesión ni ejecutor desplegado verificable. Sin generaciones de pago ni afirmación de integración real. |

La arquitectura, catálogo de modelos, audio exclusivamente Veo y ocho clips de ocho segundos se conservan. Documentación técnica contrastada para las transacciones: https://firebase.google.com/docs/firestore/manage-data/transactions . No se ejecutó el instalador contra Google Cloud; sus permisos e idempotencia real siguen pendientes.
