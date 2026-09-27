## Instalación desde el celular

Abre [Cloud Shell con Universos IA](https://shell.cloud.google.com/?authuser=1&project=alixon-jhan&cloudshell_git_repo=https%3A%2F%2Fgithub.com%2FAlixonveloz1-ctrl%2FUniversos-IA&cloudshell_git_branch=main&cloudshell_workspace=.&show=terminal) y escribe:

```bash
./c
```

Este acceso usa `alixon-jhan` y `us-central1`. Muestra los buckets existentes del proyecto: escribe el número correspondiente a `universos_ia`. Los nombres internos se configuran automáticamente. Todavía necesitas indicar el equipo y proyecto de Vercel para vincular la web, y definir tu contraseña personal. No inicia generaciones.

# Instalar desde el teléfono

## 1. Crear la web en Vercel

Importa **Alixonveloz1-ctrl/Universos-IA**, rama **main**, carpeta raíz y framework Next.js. Usa Node.js 22. Conserva el nombre del proyecto y el slug del equipo/cuenta: el instalador los pide para autorizar únicamente esa web en producción. No copies configuración de otras aplicaciones. Activa OIDC para el proyecto según [Vercel](https://vercel.com/docs/oidc/gcp).

## 2. Instalar Google Cloud y el ensamblador

[Abrir este repositorio en Cloud Shell](https://shell.cloud.google.com/?cloudshell_git_repo=https%3A%2F%2Fgithub.com%2FAlixonveloz1-ctrl%2FUniversos-IA&cloudshell_git_branch=main&cloudshell_workspace=.&show=terminal).

Cuando termine de abrir, escribe este único comando:

```bash
bash install.sh
```

Si Google solicita autenticarte, sigue el enlace que muestre la terminal. El enlace de repositorio puede abrir un entorno temporal sin credenciales; el instalador detecta ese caso y abre el acceso de Google. No envíes claves ni códigos de acceso al chat.

El asistente pide el ID de tu proyecto, el bucket y los nombres de Vercel. Los demás nombres aparecen como propuestas editables: pulsa Enter para aceptarlos. El proyecto debe tener facturación y tu cuenta debe poder habilitar APIs, crear recursos y asignar sus permisos. No cambia el proyecto global de gcloud ni asigna Owner/Editor a las identidades de la aplicación.

El comando crea o reutiliza Firestore Native, un bucket privado y un repositorio Docker; compila y despliega **un único Cloud Run Job**. El contenedor incluye `worker/media.ts`, FFmpeg y ffprobe: ese es el ensamblador. Une los ocho clips aprobados con su audio; no requiere instalar otro servicio ni copiar código. Una identidad separada compila el contenedor, sin acceso a los modelos ni a Firestore. No se generan imágenes ni videos durante la instalación. Cloud Build y los recursos de almacenamiento pueden tener costes propios.

La compilación usa el mismo bucket bajo el prefijo `universos-ia/build`; no crea otro bucket de medios. Si un recurso existente tiene un tipo, propietario o configuración de identidad incompatibles, el instalador se detiene con un error. Puedes volver a ejecutar el comando con los mismos nombres para actualizar el ejecutor. No elimina historias ni medios.

Al finalizar se muestran los valores para Vercel y se prepara tu clave personal en la terminal interactiva. Configura en Vercel:

- Todos los valores de la sección «Configuración de servidor para Vercel».
- `APP_ORIGIN`: URL HTTPS real de la web, sin barra final.
- `APP_PASSWORD_HASH` y `SESSION_SECRET`: valores privados generados en tu terminal.

Si necesitas volver a preparar únicamente el acceso, ejecuta `bash scripts/configure-access.sh`. Los secretos no se guardan en Git.

## 3. Desplegar la web

Guarda las variables para **Production** y vuelve a desplegar `main` en Vercel. La web y Cloud Run tienen configuraciones distintas; instalar uno no despliega el otro. Comprueba el acceso y crea/reabre un universo antes de iniciar una generación de pago.

## Qué está comprobado

El instalador se prueba localmente con un gcloud **simulado**, incluyendo instalación, actualización, rechazo de bucket inseguro o ajeno y rechazo de confianza WIF distinta. Eso no demuestra permisos ni ejecución real en tu cuenta. La instalación real, OIDC, persistencia y generaciones deben comprobarse tras desplegar.

Fuentes técnicas: [Cloud Shell](https://docs.cloud.google.com/shell/docs/open-in-cloud-shell), [Cloud Build con identidad propia](https://docs.cloud.google.com/build/docs/securing-builds/configure-user-specified-service-accounts), [gcloud builds submit](https://docs.cloud.google.com/sdk/gcloud/reference/builds/submit), [metadatos originales del bucket](https://docs.cloud.google.com/sdk/gcloud/reference/storage/buckets/describe).
