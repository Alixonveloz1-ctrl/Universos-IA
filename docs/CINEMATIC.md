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

El selector de estilo ofrece **Cinemático realista** y **Anime 2D** con ilustración detallada, fondos pintados y actuación expresiva. Los dos utilizan el mismo flujo de planos, voces, audio nativo, aprobaciones y montaje. El estilo queda guardado por producción y se repite explícitamente en el Director, las referencias de personajes, las imágenes iniciales y Veo. El anime usa diseños originales; no replica personajes ni escenas existentes. Cinemático mantiene sus propias elecciones visuales, aisladas de las otras dos secciones.

El formulario incluye nueve géneros y sus subgéneros dependientes. El concepto escrito es opcional: si existe, determina la historia y tiene prioridad sobre las categorías; en blanco, el Director inventa una trama para el género y subgénero seleccionados. Tras ver el plan se puede pedir otra trama con las mismas elecciones; el Director recibe un resumen de la anterior para variar la nueva propuesta. Si ya se aprobaron imágenes o videos, la interfaz avisa que una nueva versión reiniciará esas aprobaciones y la película final de esa producción.

Cada bloque técnico puede contener varios planos internos. Se permiten y se programan hard cuts, POV, inserts, close-ups y reaction shots. La primera toma parte de una imagen inicial aprobada; Veo crea los cortes posteriores dentro del mismo bloque.

Para mejorar la estabilidad, se pide al Director normalmente 2–3 planos en 8 segundos y 1–2 en 4 o 6 segundos, con un solo beat físico principal por bloque. Fija la hora, el clima, la dirección de la luz, la posición de las personas y el estado de los objetos. La imagen inicial debe representar el estado anterior al descubrimiento: si alguien va a desenterrar un ataúd, la tierra todavía lo tapa; no se acepta como punto de partida un pozo que ya lo deja a la vista. El Director conserva la excavación de la historia y planifica cuándo y cómo aparece el ataúd. El generador de la imagen recibe el objetivo y las acciones posteriores como sucesos que aún no deben mostrarse; la pantalla enseña la dirección del fotograma inicial para compararla con la imagen antes de aprobarla. El prompt de Veo usa la imagen aprobada como autoridad visual y se concentra en movimiento, acciones con causa y efecto, cortes y audio nativo. Una lista negativa específica para Cinemático busca reducir manos duplicadas, herramientas flotantes, utilería que cambia y cuadros negros no previstos. Ninguna de estas indicaciones garantiza un resultado perfecto: la aprobación sigue siendo manual y se muestran todas las versiones generadas.

El selector de video ofrece Veo 3.1 Lite, Fast y Veo 3.1. El valor inicial sigue siendo Lite; cambiar a otro modelo es una elección manual antes de pagar una nueva generación. Los prompts nuevos se aplican a videos regenerados y a producciones nuevas; no alteran los MP4 ya guardados.

## Audio

Todo el audio se solicita nativamente en Veo. El plan contiene una única Biblia Sonora global con identidad musical, instrumentación, tempo, ambiente, mezcla de diálogo, lenguaje de efectos y regla de continuidad. Esa misma Biblia se inyecta en cada prompt.

Cada personaje guarda una voz canónica. Las intervenciones vuelven a enviar el mismo perfil de timbre, registro, ritmo, energía, dicción, expresión, idioma y acento.

## Flujo

1. Elegir el estilo visual, género, subgénero y, si se desea, escribir un concepto propio.
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
