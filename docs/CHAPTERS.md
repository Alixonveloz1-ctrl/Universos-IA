# Un universo, una historia

Cada historia nueva crea su propio universo al elegir una propuesta. No se permite crear otra historia independiente indicando un universo existente.

Desde un capítulo terminado y exportado, «Crear siguiente capítulo» crea una sola continuación de 64 segundos. Repetir la petición abre el mismo capítulo, incluso con peticiones concurrentes. El capítulo anterior queda protegido de edición para conservar el origen de la continuidad. No se inicia ninguna llamada de generación al crear el capítulo: el usuario solicita las tres continuaciones desde su pantalla.

La continuación conserva el universo, la historia aprobada de cada capítulo anterior, el estado final observado, las fichas canónicas, sus imágenes aprobadas y el último fotograma. Las imágenes se reutilizan por referencia; no se copian archivos ni se generan otra vez automáticamente. El Director puede añadir personajes y escenarios, pero no sustituir fichas canónicas anteriores. La evolución narrativa se expresa en la historia y estados de las escenas.

El primer clip debe comenzar con el estado final observado anterior. Si su modo es previousFrame, el worker envía físicamente el último fotograma anterior a Veo. Si cambia el encuadre, usa el storyboard del nuevo capítulo con sus referencias canónicas. Las aprobaciones de historia, biblia, guion, imágenes y videos siguen vigentes.

La exportación de origen debe corresponder exactamente a los ocho clips actualmente aprobados, sin revisiones pendientes. El historial no se recorta silenciosamente: si supera el límite de documento/snapshot se detiene con un mensaje.

Actualizar el worker una vez con ./s desde main actualizado: etiqueta story-flow=chapters-v1. No modifica contraseñas ni variables de Vercel.

Verificación: transacciones y proveedores simulados, pruebas de navegador simuladas y montaje FFmpeg local. No se ha generado una serie real con proveedores de pago; la continuidad visual/voz generada debe revisarse al aprobar los clips.
