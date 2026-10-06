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

El ensamblador guarda un manifiesto inmutable de los MP4 aprobados y de la revisión del proyecto. Normaliza video, audio y marcas de tiempo antes de unirlos; valida duración y continuidad de paquetes. Si cambian las aprobaciones durante la ejecución, conserva el archivo de ese trabajo para diagnóstico pero no lo publica como película vigente.

## Lenguaje de producción

El Director cinematográfico tiene un Master Style propio: short drama fotorealista, live-action-like, vertical 9:16 y fotografía de alto presupuesto. No hereda estilos Anime/3D de Universos.

Cada bloque técnico puede contener varios planos internos. Se permiten y se programan hard cuts, POV, inserts, close-ups y reaction shots. La primera toma parte de una imagen inicial aprobada; Veo crea los cortes posteriores dentro del mismo bloque.

Para mejorar la estabilidad, se pide al Director normalmente 2–3 planos en 8 segundos y 1–2 en 4 o 6 segundos, con un solo beat físico principal por bloque. Fija la hora, el clima, la dirección de la luz, la posición de las personas y el estado de los objetos. El prompt de imagen establece esas anclas; el prompt de Veo usa la imagen aprobada como autoridad visual y se concentra en movimiento, acciones con causa y efecto, cortes y audio nativo. Una lista negativa específica para Cinemático busca reducir manos duplicadas, herramientas flotantes, utilería que cambia y cuadros negros no previstos. Ninguna de estas indicaciones garantiza un resultado perfecto: la aprobación sigue siendo manual y se muestran todas las versiones generadas.

El selector de video ofrece Veo 3.1 Lite, Fast y Veo 3.1. El valor inicial sigue siendo Lite; cambiar a otro modelo es una elección manual antes de pagar una nueva generación. Los prompts nuevos se aplican a videos regenerados y a producciones nuevas; no alteran los MP4 ya guardados.

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

Cada generación de pago recibe un ID de intento persistente antes de llamar a Google. Un reintento HTTP consulta ese mismo intento y no vuelve a pagar automáticamente. Si se pierde la respuesta, la interfaz ofrece reconciliarlo; un video de inicio incierto solo puede cerrarse después de 24 horas si todavía no aparece el MP4 del prefijo privado. Los trabajos de ensamblado cuyo despacho es incierto se reenvían con el mismo ID después de 70 minutos, cuando la ejecución anterior ya excedió su tiempo máximo. No borres una producción con operaciones pendientes.

## Despliegue

El worker necesita la etiqueta `cinematic-flow=v1`. `./s` la añade también a los jobs preexistentes. Después de actualizar el código, ejecuta `./s` antes de ensamblar una producción cinematográfica.

La verificación dedicada `Verify cinematic production` ejecuta lint, TypeScript, el contrato de duraciones/prompts y el build sin realizar generaciones pagadas.
