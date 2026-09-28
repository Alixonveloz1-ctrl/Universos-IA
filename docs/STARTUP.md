# Arranque y selección de modelos

Antes de crear un proyecto o encolar una generación, la web comprueba el acceso y la compatibilidad del worker. Una denegación HTTP se distingue de un worker desactualizado. Un fallo previo al envío se registra como fallido; un envío de resultado incierto conserva el mismo trabajo y muestra el error para recuperarlo sin duplicar llamadas.

Los trabajos antiguos en cola sin operación confirmada reciben una comprobación del ejecutor al abrirlos, después de 30 segundos. No se repiten generaciones automáticamente. Los fallos al adquirir un puesto en el worker también se registran, en lugar de dejar el estado en cola.

Los selectores de modelos permanecen editables. Cambiar modelos cancela un trabajo en cola que nunca comenzó y cierra ese intento. El usuario puede generar con su nueva selección. Un trabajo en ejecución conserva su snapshot/modelos; los nuevos valores se aplican a los próximos trabajos sin invalidar su revisión narrativa.

El Director admite Gemini 3 Flash Preview y Gemini 3.1 Pro Preview. Documentación del segundo: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-1-pro . Las opciones de imágenes y video conservan los modelos existentes. Disponibilidad y cuota dependen del proyecto de Google Cloud.

./s actualiza la imagen y ejecuta una comprobación de arranque con WORKER_SELF_TEST=1 solo para esa ejecución. Verifica escritura/lectura en Firestore y el bucket, eliminando el objeto temporal. No llama a Vertex ni genera contenido. El comando falla si la comprobación falla; no anuncia éxito prematuramente. Documentación de overrides: https://docs.cloud.google.com/sdk/gcloud/reference/run/jobs/execute .

No se dispone de acceso autenticado a la cuenta Cloud del usuario desde el entorno de desarrollo. La causa concreta del atasco de producción debe confirmarse con la comprobación real y el error mostrado por la aplicación.
