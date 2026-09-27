# Mapa de dependencias y decisiones

Lectura completa realizada antes de crear código: 19 secciones de Universos_IA_Plan_Completo_V2.docx, tablas, encabezados, pie y enlaces. El nombre interno es versión 2.0. No se recibió un archivo distinto llamado Final.

## Puertas del flujo

Universo versionado → tres ideas → selección → historia aprobada → biblia aprobada → referencias canónicas aprobadas → guion aprobado → storyboard aprobado → clip 1 revisado → clips siguientes con estado observado del anterior → ocho aprobaciones sin conflictos → exportación de manifiesto inmutable.

La API valida pertenencia, revisión, estado y precondiciones. El Director no controla permisos, duración, audio, modelos admitidos ni punteros de aprobación. Los bytes se persisten antes de publicar una candidata. El trabajo completado no equivale a una aprobación.

## Persistencia

`universes`: reglas y revisión. `projects`: copia de universo, selecciones, versiones narrativas activas y revisión. Subcolecciones `narratives`, `targets`, `assets`, `observed`, `approvals`, `reviews`, `exports` conservan contenido, decisiones e historial. `jobs`: snapshot inmutable, idempotencia, checkpoint, operación, lease, estado, errores. `system/workerSlots`: límite global. `system/login`: límite persistente de intentos de acceso.

Los assets conservan prompts efectivos, modelo, configuración, referencias enviadas, versiones fuente, checksums, datos técnicos y objeto privado. Exportaciones congelan ocho IDs ordenados. No se usan URLs firmadas como identidad persistente ni localStorage como base de datos.

## Operaciones

Lectura, edición, selección y aprobación son cortas. Director, imágenes, videos y unión devuelven 202 con jobId y se ejecutan fuera de Vercel en un único Cloud Run Job. Transacciones Firestore no contienen llamadas a proveedores. El worker tiene heartbeat y checkpoint antes de llamadas con consumo. Un timeout ambiguo exige reconciliación; nunca cambia de modelo como fallback.

## Estados

Trabajos: queued, running, waiting, completed, failed, stopped, needsReview. Editorial: draft, candidate, approved, rejected, needsReview. La aprobación real se registra como evento más puntero en el target; los bytes y metadatos de la versión no se sobrescriben. Cambiar un activo marca dependencias, sin generaciones automáticas. El modo utilizado por defecto es imagen inicial; no se envían arbitrariamente todas las imágenes del storyboard a Veo.
