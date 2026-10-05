# Producciones cinematográficas

La tercera entrada de Universos IA vive aislada de los dos flujos existentes:

- **Mis proyectos** conserva el flujo de universos/historias de 64 segundos.
- **Video directo** conserva imagen + prompt + Veo.
- **Cinemático** usa su propia colección `cinematicProjects`, su propia API y su propio plan de producción.

## Duraciones

Los videos finales se dividen únicamente en duraciones nativas compatibles con el adaptador de Veo:

- 30 s = 8 + 8 + 8 + 6
- 60 s = 8 + 8 + 8 + 8 + 8 + 8 + 8 + 4
- 90 s = 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 6 + 4

El ensamblador concatena los MP4 aprobados y valida que audio y video cubran la duración exacta.

## Lenguaje de producción

El Director cinematográfico tiene un Master Style propio: short drama fotorealista, live-action-like, vertical 9:16 y fotografía de alto presupuesto. No hereda estilos Anime/3D de Universos.

Cada bloque técnico puede contener varios planos internos. Se permiten y se programan hard cuts, POV, inserts, close-ups y reaction shots. La primera toma parte de una imagen inicial aprobada; Veo crea los cortes posteriores dentro del mismo bloque.

## Audio

Todo el audio se solicita nativamente en Veo. El plan contiene una única Biblia Sonora global con identidad musical, instrumentación, tempo, ambiente, mezcla de diálogo, lenguaje de efectos y regla de continuidad. Esa misma Biblia se inyecta en cada prompt.

Cada personaje guarda una voz canónica. Las intervenciones vuelven a enviar el mismo perfil de timbre, registro, ritmo, energía, dicción, expresión, idioma y acento.

## Flujo

1. Escribir el concepto.
2. Elegir 30/60/90 s y los modelos de Director, imagen y video.
3. Generar el plan cinematográfico.
4. Generar y aprobar referencias canónicas de personajes.
5. Generar y aprobar la imagen inicial de cada bloque.
6. Generar, escuchar/revisar y aprobar cada bloque Veo.
7. Ensamblar únicamente los videos aprobados.

Cambiar de modelo afecta generaciones futuras; los activos anteriores conservan el modelo con el que fueron creados. Aprobar una referencia nueva invalida solo los bloques cinematográficos dependientes.

## Despliegue

El worker necesita la etiqueta `cinematic-flow=v1`. Después de actualizar el código, ejecutar `./s` (o el flujo equivalente de actualización del worker) antes de ensamblar una producción cinematográfica.

La verificación dedicada `Verify cinematic production` ejecuta lint, TypeScript, el contrato de duraciones/prompts y el build sin realizar generaciones pagadas.
