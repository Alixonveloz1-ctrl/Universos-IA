# Contratos consultados

Solo se adoptan IDs y ubicaciones del repositorio de referencia studio.LegadodeHierro, commit 5eeb18b9821a635bc9c48cdd93bb51d61eb01555. Se leyó server/video-start.js; no se modificó ese repositorio ni se reutilizaron sus recursos, credenciales, prompts o reglas editoriales. La especificación V2 define los IDs restantes y las ubicaciones.

Fuentes consultadas:

- Parámetros Veo: https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rest/Shared.Types/VideoGenerationModelParams
- Modalidades Veo 3.1: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/veo/3-1-generate
- Imágenes Gemini: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/image-generation
- Cloud Run Jobs: https://docs.cloud.google.com/run/docs/execute/jobs
- Firestore: https://docs.cloud.google.com/firestore/native/docs/manage-data/transactions
- Vercel OIDC/WIF: https://vercel.com/docs/oidc/gcp
- FFmpeg concat: https://ffmpeg.org/ffmpeg-formats.html#concat-1

No se cambian los modelos confirmados por el propietario. El registro distingue imagen inicial y referencias. Lite se restringe a imagen inicial; esta implementación envía ese modo en video. La disponibilidad y los contratos de todos los modelos del catálogo todavía requieren pruebas reales con el proyecto configurado. No hubo sustituciones silenciosas.

La tolerancia técnica del archivo es un frame más 25 ms de contenedor; también se cuenta el número de frames. No se acepta un clip de seis segundos como ocho. La prueba local de concatenación usa archivos sintéticos y no acredita continuidad artística ni voz de Veo.

## Verificación adicional, 27 de septiembre de 2026

- Gemini 2.5 Flash Image: máximo de tres imágenes de entrada y 7 MB por archivo inline. https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/2-5-flash-image
- Gemini 3.1 Flash Image y Gemini 3 Pro Image: catorce imágenes de entrada, 7 MB inline. https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-1-flash-image y https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-pro-image
- `storage.objects.list` se autoriza al nivel del bucket; una condición `resource.name` de objetos no permite listar. El instalador asigna al worker un rol separado que solo permite listar nombres en el bucket elegido; get/write siguen limitados al prefijo. La app lista exclusivamente el destino de un intento. No se afirma que IAM limite el listado a ese prefijo. https://docs.cloud.google.com/storage/docs/access-control/iam

No se realizaron llamadas reales de generación al verificar estas páginas.
