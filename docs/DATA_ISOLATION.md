# Separación de datos

Web y worker usan exclusivamente `applications/universos-ia-v1` dentro de la base Firestore configurada. Universos, proyectos, trabajos, checkpoints, aprobaciones y controles internos quedan bajo ese documento. No hay lectura alternativa ni migración automática desde las colecciones raíz: pueden pertenecer a otras aplicaciones.

Esta es separación de rutas de la aplicación, no una nueva base ni una restricción IAM por documento. Los permisos existentes de Firestore no cambian. Los archivos siguen en el bucket configurado y su prefijo.

## Actualizar una instalación existente

La web se publica desde main en Vercel. En Cloud Shell, abrir el repositorio actualizado y ejecutar `./s`. En una copia ya abierta, ejecutar primero `git pull --ff-only`.

`./s` valida el proyecto y bucket del job existente, compila el worker y actualiza solo su imagen y etiqueta de compatibilidad. Conserva variables, contraseñas y permisos. No ejecuta generaciones ni modifica registros anteriores. Requiere los permisos de Cloud Build y Cloud Run usados en la instalación inicial.

La web comprueba la etiqueta del worker antes de iniciar trabajos. Hasta actualizarlo, muestra una indicación para ejecutar `./s`; nunca envía trabajos nuevos al ejecutor antiguo. Los registros anteriores no aparecerán en el espacio nuevo. Cualquier migración debe identificar primero qué registros pertenecen realmente a esta aplicación.
