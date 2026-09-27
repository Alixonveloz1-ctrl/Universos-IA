# Universos-IA

Implementación en desarrollo de la especificación Universos IA V2. No es una entrega terminada ni está desplegada. El código usa servicios reales; solo las pruebas contienen simuladores. Consultar `docs/AUDITORIA.md` antes de instalar.

## Arquitectura

Next.js y TypeScript para Vercel; Firestore para proyectos y trabajos; un bucket privado; un único Cloud Run Job con Director, imágenes, Veo y FFmpeg. Las voces, música y efectos se generan únicamente dentro de Veo. El ensamblador concatena ocho clips aprobados de ocho segundos.

## Desarrollo y comprobaciones

Node 22 y FFmpeg/ffprobe instalados. Ejecutar `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. `npm run dev` inicia la aplicación; no hay datos ficticios ni modo público cuando faltan credenciales. La configuración ausente produce errores explícitos. Las cookies de acceso requieren HTTPS; para desarrollo del acceso usar HTTPS local.

`npm run test:e2e` usa Playwright. Tres escenarios de interfaz (incluido el recorrido hasta exportación y recarga) interceptan API con datos marcados SIMULATED. El escenario de acceso sin sesión sí consulta el backend local. Ninguna prueba de CI consume créditos.

## Configuración privada

El propietario configura los valores directamente en Vercel y Google Cloud. No necesita compartirlos en el chat, añadirlos al repositorio ni exponerlos al cliente. `.env.example` solo enumera nombres.

| Variable | Uso |
|---|---|
| GCP_PROJECT_ID | Proyecto elegido por el propietario |
| GCS_OUTPUT_BUCKET | Nombre de un bucket privado, sin gs:// |
| GCS_PREFIX | Prefijo exclusivo de esta aplicación |
| FIRESTORE_DATABASE_ID | Base de datos elegida |
| CLOUD_RUN_JOB_RESOURCE | Nombre completo del ejecutor desplegado |
| APP_ORIGIN | Origen HTTPS real de producción, sin rutas |
| APP_PASSWORD_HASH | Hash scrypt de la clave de acceso personal |
| SESSION_SECRET | Secreto aleatorio de al menos 32 caracteres |
| GCP_SERVICE_ACCOUNT_EMAIL | Identidad web federada, no clave privada |
| GCP_WIF_AUDIENCE | Recurso del proveedor WIF |
| DIRECTOR_MODEL / IMAGE_MODEL / VIDEO_MODEL | Predeterminados del registro permitido |
| MAX_ACTIVE_JOBS | Límite de ejecutores simultáneos, 1 inicialmente |

`node scripts/access-secret.mjs` lee la contraseña por stdin y devuelve valores para configurar privadamente. No escribir la contraseña en argumentos de shell ni guardarla en Git. Cloud Run usa su propia identidad adjunta. Vercel usa OIDC/WIF, sin claves privadas de servicio. El repositorio no contiene credenciales iniciales.

## Instalación pendiente de prueba real

Desde Cloud Shell abierto en este repositorio, ejecuta **`bash install.sh`**. Instala el único ejecutor con FFmpeg y el ensamblador incluido; pide la configuración en la terminal y muestra las variables de Vercel. [Abrir Cloud Shell y ver instrucciones](docs/INSTALACION.md). El despliegue de la web en Vercel lo realiza el propietario.

El repositorio propio es https://github.com/Alixonveloz1-ctrl/Universos-IA. Desde un checkout de este repositorio, `bash scripts/setup-gcp.sh` solicita recursos, prepara la imagen del worker y publica el job. Debe ejecutarlo el propietario en su Cloud Shell. No se debe ejecutar contra recursos de otros proyectos sin seleccionarlos expresamente.

El instalador está escrito pero no probado en Google Cloud. Revisar nombres, permisos y proyecto destino antes de ejecutarlo. No inicia generaciones de modelos. Los nombres de Vercel y WIF son entradas del instalador; no son valores preseleccionados de otra aplicación. Conectar el repositorio nuevo a Vercel con producción desde main, configurar variables y OIDC. No presentar como terminada esta instalación hasta verificar el inicio de sesión, generación real y redeploy.

## Uso

1. Entrar, crear un universo, seleccionar género/subgénero/trama/tono/cierre y pedir tres ideas.
2. Elegir una propuesta, generar historia, leer/editar y aprobar.
3. Generar y aprobar biblia; generar y aprobar referencias canónicas individualmente.
4. Generar y aprobar el guion de ocho clips; producir imágenes por toma.
5. Generar y revisar con sonido los clips en orden. Al aprobar, confirmar el estado observado.
6. Resolver revisiones de continuidad y unir las ocho versiones aprobadas. Una exportación anterior sigue identificada por su manifiesto.

## Recuperación y límites conocidos

Los trabajos se registran antes de lanzar Cloud Run. Una ejecución adquiere un lease; las consultas a una operación Veo existente no generan otro clip. Si se pierde la respuesta inicial de una generación, se bloquea la repetición automática. La acción «Comprobar recuperación» busca respuestas persistidas y objetos del mismo intento, sin repetir llamadas pendientes. Si no existe resultado recuperable, se puede cerrar el intento con una nota y reconocimiento del posible consumo. El backend exige una comprobación previa; conserva todo el historial y no genera otra versión al cerrar. No borrar ni alterar manualmente el checkpoint.

Una ejecución de video ya aceptada puede seguir produciendo y consumir créditos después de pulsar Detener. En lotes de imágenes se detienen nuevas solicitudes entre elementos. Los límites globales pueden dejar un trabajo en cola: reanudar cuando se libere el ejecutor. No hay un scheduler separado.

Los guiones/biblias candidatos se conservan en versiones narrativas. La interfaz permite editar listas, personajes, escenarios, universos y modelos de la historia. Los borradores conservan su revisión base para evitar sobrescribir cambios después de una actualización. La portada estática se inspira en el diseño adjunto; falta comprobar el conjunto en navegador móvil. La revisión semántica del Director y la compilación de prompts usan el proveedor real de texto, con resultados duraderos y como máximo una reparación del borrador narrativo.

## Verificación real posterior

Primero instalar y configurar privadamente. Luego verificar acceso, denegación de rutas sin sesión, URLs firmadas, permisos de ambos servicios y preservación de datos tras redeploy. Autorizar y ejecutar un smoke de imagen y un clip real; medir audio/duración/9:16 y revisar voz e identidad. El recorrido completo requiere ocho generaciones de video explícitamente autorizadas. Conservar resultados y auditoría sin divulgar secretos. El código no debe declararse terminado hasta resolver todos los bloqueos de `docs/AUDITORIA.md`.

## Referencias de imagen y límites

Cada storyboard adjunta las referencias aprobadas de los personajes y del escenario de esa toma. Una regeneración canónica usa su versión anterior como referencia. El modelo predeterminado admite tres referencias; los otros modelos de imagen del catálogo admiten catorce. Si una toma supera el límite, se bloquea antes de iniciar el trabajo y se requiere cambiar explícitamente de modelo. No se omiten referencias ni se cambia de modelo en silencio.

## Arte estático

`public/universos-hero.png` es arte de portada creado durante la implementación, no un resultado ni una integración ficticia de Google. Su procedencia y prompt están en `docs/ARTE.md`.


## Continuación del 27 de septiembre

El ZIP original se verificó por SHA-256 y se continuó sobre su código. En esta sesión pasan 51 pruebas, lint, TypeScript, build y comprobación de sintaxis del instalador. Se corrigieron bloqueos de operación pendiente, invalidación de referencias y escritura de respuestas tardías bajo lease. Consultar la última sección de la auditoría para separar esta evidencia de la entrega previa y para los bloqueos actuales de despliegue. Ninguna prueba local genera contenido pagado.
