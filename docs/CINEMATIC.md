# Producciones cinematográficas

La tercera entrada de Universos IA vive aislada de los dos flujos existentes:

- **Mis proyectos** conserva el flujo de universos/historias de 64 segundos.
- **Video directo** conserva imagen + prompt + Veo.
- **Cinemático** usa su propia colección `cinematicProjects`, su propia API y su propio plan de producción.

## Duraciones

Los planes nuevos dividen la película en tomas independientes de duración nativa para video desde una imagen inicial:

- 30 s = seis tomas de 4 s y una de 6 s (7 imágenes y 7 videos).
- 60 s = diez tomas de 6 s (10 imágenes y 10 videos).
- 90 s = quince tomas de 6 s (15 imágenes y 15 videos).

Cada toma se planifica con un único plano que cubre toda su duración. Su imagen inicial es la fuente del video correspondiente. El siguiente ángulo, insert o reacción tiene otra imagen inicial y otra generación; el editor hace el corte entre los MP4 aprobados. Los planes anteriores conservan sus duraciones originales y pueden ensamblarse sin migración. Pedir un plan nuevo en una producción anterior la convierte al formato por toma y reinicia las aprobaciones de ese plan.

El ensamblador guarda un manifiesto inmutable de los MP4 aprobados y de la revisión del proyecto. Normaliza video, audio y marcas de tiempo antes de unirlos; valida duración y continuidad de paquetes. Si cambian las aprobaciones durante la ejecución, conserva el archivo de ese trabajo para diagnóstico pero no lo publica como película vigente.

## Lenguaje de producción

El selector de estilo ofrece **Cinemático realista** y **Anime 2D** con ilustración detallada, fondos pintados y actuación expresiva. Los dos utilizan el mismo flujo de planos, voces, audio nativo, aprobaciones y montaje. El estilo queda guardado por producción y se repite explícitamente en el Director, las referencias de personajes, las imágenes iniciales y Veo. El anime usa diseños originales; no replica personajes ni escenas existentes. Cinemático mantiene sus propias elecciones visuales, aisladas de las otras dos secciones.

El formulario incluye nueve géneros y sus subgéneros dependientes. El concepto escrito es opcional: si existe, determina la historia y tiene prioridad sobre las categorías; en blanco, el Director inventa una trama para el género y subgénero seleccionados. Tras ver el plan se puede pedir otra trama con las mismas elecciones; el Director recibe un resumen de la anterior para variar la nueva propuesta. Si ya se aprobaron imágenes o videos, la interfaz avisa que una nueva versión reiniciará esas aprobaciones y la película final de esa producción.

El Director distribuye los planos entre tomas, con un beat físico realizable por video y sin cortes internos, cambios de escenario o contraplano inventado por Veo. Fija la hora, el clima, la dirección de la luz, la posición de las personas y el estado de los objetos. La imagen inicial debe representar el estado anterior al descubrimiento: si alguien va a desenterrar un ataúd, la tierra todavía lo tapa; no se acepta como punto de partida un pozo que ya lo deja a la vista. El Director conserva la excavación de la historia y planifica cuándo y cómo aparece el ataúd. El generador de cada imagen recibe el objetivo y la acción posterior como sucesos que aún no deben mostrarse; la pantalla enseña la dirección del fotograma inicial para compararla con la imagen antes de aprobarla. El prompt de Veo usa la imagen aprobada como autoridad visual y se concentra en el movimiento de esa única toma y su audio nativo. Una lista negativa específica para Cinemático busca reducir manos duplicadas, herramientas flotantes, utilería que cambia y cuadros negros no previstos. Ninguna de estas indicaciones garantiza un resultado perfecto: la aprobación sigue siendo manual y se muestran todas las versiones generadas. El mayor número de tomas implica más generaciones y tiempo/costo que el formato anterior.

Los planes nuevos también declaran, por cada toma, la posición y profundidad de cada persona, qué partes se ven, qué rostros aparecen desde el primer fotograma y qué contactos físicos existen. El Director fija esa geometría antes de redactar el encuadre y la acción. Se rechaza un contacto entre una persona al fondo y otra en primer plano. Una mano junto al borde solo puede pertenecer a la persona situada inmediatamente fuera de ese borde, sin duplicarla en el fondo. Veo recibe una regla de visibilidad: un rostro que no figure en la imagen inicial permanece fuera de cuadro durante todo ese video. Un personaje fuera de cuadro puede hablar desde su posición sin que aparezca un rostro ni que otro personaje mueva los labios por él; si la historia necesita mostrar su cara, el Director lo presenta en otra toma con su propia imagen inicial. Para planes anteriores sin estos datos, el prompt de imagen también impone geometría física y el video mantiene ocultos los rostros ausentes del fotograma inicial. El resultado visual sigue requiriendo aprobación humana.

El selector de video ofrece Veo 3.1 Lite, Fast y Veo 3.1. El valor inicial sigue siendo Lite; cambiar a otro modelo es una elección manual antes de pagar una nueva generación. Los prompts nuevos se aplican a videos regenerados y a producciones nuevas; no alteran los MP4 ya guardados.

Cuando una versión de video no se aprueba, el siguiente intento con la misma imagen simplifica y ralentiza la acción; tras otro intento no aprobado, reduce el movimiento a un paso o gesto y deja el resto para la toma siguiente. El Director solo permite cruzar una puerta por una abertura visible y conserva el panel y el marco como obstáculos sólidos. Se puede añadir una indicación breve para corregir el movimiento de una toma concreta sin cambiar las demás; la versión y el prompt exacto quedan guardados como otro intento. Después de varios intentos se aconseja regenerar la imagen inicial si su postura o trayecto impiden una animación coherente. Los rechazos de seguridad de Google se muestran como tales y no desencadenan reintentos automáticos.

## Audio

Todo el audio se solicita nativamente en Veo. El plan contiene una única Biblia Sonora global con identidad musical, instrumentación, tempo, ambiente, mezcla de diálogo, lenguaje de efectos y regla de continuidad. Esa misma Biblia se inyecta en cada prompt.

Cada personaje guarda una voz canónica. Las intervenciones vuelven a enviar el mismo perfil de timbre, registro, ritmo, energía, dicción, expresión, idioma y acento.

## Flujo

1. Elegir el estilo visual, género, subgénero y, si se desea, escribir un concepto propio.
2. Elegir 30/60/90 s y los modelos de Director, imagen y video.
3. Generar el plan cinematográfico.
4. Generar y aprobar referencias canónicas de personajes.
5. Generar y aprobar la imagen inicial de cada toma.
6. Generar, escuchar/revisar y aprobar cada toma Veo.
7. Ensamblar únicamente los videos aprobados.

Cambiar de modelo afecta generaciones futuras; los activos anteriores conservan el modelo con el que fueron creados. Aprobar una referencia nueva invalida solo los bloques cinematográficos dependientes.

Cada generación de pago recibe un ID de intento persistente antes de llamar a Google. Un reintento HTTP consulta ese mismo intento y no vuelve a pagar automáticamente. Si se pierde la respuesta, la interfaz ofrece reconciliarlo; un video de inicio incierto solo puede cerrarse después de 24 horas si todavía no aparece el MP4 del prefijo privado. Los trabajos de ensamblado cuyo despacho es incierto se reenvían con el mismo ID después de 70 minutos, cuando la ejecución anterior ya excedió su tiempo máximo. No borres una producción con operaciones pendientes.

## Despliegue

El worker necesita la etiqueta `cinematic-flow=v1`. `./s` la añade también a los jobs preexistentes. Después de actualizar el código, ejecuta `./s` antes de ensamblar una producción cinematográfica.

La verificación dedicada `Verify cinematic production` ejecuta lint, TypeScript, el contrato de duraciones/prompts y el build sin realizar generaciones pagadas.
