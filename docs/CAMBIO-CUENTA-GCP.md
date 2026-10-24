# Cambiar de cuenta de Google Cloud — guía simple

Esta guía es para cuando quieres dejar la cuenta vieja de Google Cloud y
usar otra nueva. No necesitas entender código para seguirla, solo seguir
los pasos en orden. Nada de esto genera videos de pago por sí solo.

## Qué cambia, en palabras simples

Google Cloud es donde viven tres cosas de la app:

1. La base de datos, donde se guardan tus proyectos e historias.
2. El almacén, donde se guardan las imágenes y los videos.
3. El ensamblador, que es el programa que une los clips al final.

Si cambias de cuenta, esas tres cosas cambian de casa. Por eso hay que
instalar el ensamblador de nuevo en la cuenta nueva, y decirle a Vercel
cuál es la casa nueva. Si no se hace esto, la web seguirá buscando la
casa vieja y fallará.

## Qué NO se mueve solo

Los proyectos, historias, imágenes y videos que ya están en la cuenta
vieja no se mudan solos a la nueva. Si quieres conservarlos, hay que
exportarlos antes de cambiar, y eso es un paso aparte. Si empiezas de
cero en la cuenta nueva, tus proyectos viejos quedarán en la cuenta
vieja, no se borran solo por cambiar la web, pero la web nueva no los
verá.

## Antes de instalar: comprueba los créditos

La cuenta vieja no sirve aunque el código esté bien, porque no tiene
saldo ni créditos. Antes de instalar en la cuenta nueva, entra a su
consola de Google Cloud y comprueba que la facturación está activa y
que tiene saldo o créditos positivos. Si la cuenta nueva tampoco tiene
saldo, Veo no podrá generar, aunque todo lo demás esté bien instalado.
Este paso no genera ningún gasto: solo es mirar el saldo.

## Pasos, en orden

1. En la cuenta nueva de Google Cloud, crea un proyecto nuevo y activa
   la facturación. Anota su ID, que es un nombre corto sin espacios.
2. En esa cuenta nueva, crea un almacén privado nuevo, solo para esta
   app. Anota su nombre.
3. Abre Cloud Shell en la cuenta nueva, con el código actualizado, y
   ejecuta el instalador. El instalador te preguntará el proyecto, la
   región, el almacén y el equipo de Vercel. Escribe tus valores nuevos
   en la terminal, nunca en el código ni en el chat.

   ```bash
   bash install.sh
   ```

   Esto crea la base de datos, el almacén si falta, las cuentas de
   servicio nuevas, y el ensamblador nuevo en Cloud Run. Cloud Run es
   el programa que une los clips al final; sin él, la web puede generar
   clips pero no puede entregar el video final. No genera imágenes ni videos.
   Al final, el instalador comprueba el ensamblador con una prueba
   interna, sin generar contenido de pago.
4. Al terminar, el instalador te mostrará los valores nuevos para Vercel.
   Son, solo por nombre, sin valores reales aquí: proyecto, almacén,
   prefijo, base de datos, recurso del ensamblador, correo de la cuenta
   de servicio de la web, y la audiencia WIF. También te dará una clave
   nueva de acceso.
5. En Vercel, actualiza esas variables en Production con los valores
   nuevos, y vuelve a publicar la versión de main. No copies variables
   de la cuenta vieja. Si una variable vieja queda, la app mezclará las
   dos casas y fallará. Las variables de la cuenta vieja que hay que
   sustituir, solo por nombre, son: proyecto, almacén, prefijo, base
   de datos, recurso del ensamblador en Cloud Run, correo de la cuenta
   de servicio de la web y audiencia WIF. La contraseña de la web, el
   secreto de sesión y los modelos pueden quedar igual, salvo que
   quieras una clave nueva.
6. Comprueba que Cloud Run quedó en la cuenta nueva: en la consola de
   la cuenta nueva debe aparecer el trabajo del ensamblador, y en la
   cuenta vieja ya no debe ser el que usa la web. Si la web sigue
   apuntando a la cuenta vieja, el error será de saldo, no de código.
6. Prueba sin gasto: entra con la clave nueva, crea un proyecto de
   prueba y comprueba que se guarda y se vuelve a abrir. Solo después
   de eso, haz tú la prueba de pago, una imagen y un video, como en
   `docs/SMOKE-VERIFICATION.md`.

## Atajos que ya no funcionan

Los atajos viejos `c`, `d` y `s` ya no traen ningún nombre guardado.
Ahora necesitan que les digas el proyecto y el almacén nuevos con
variables de entorno, por ejemplo antes de ejecutar `d`:

```bash
export GCP_PROJECT_ID="tu-proyecto-nuevo"
export GCS_OUTPUT_BUCKET="tu-almacen-nuevo"
./d
```

Si falta un dato, el script se detiene y te dice qué falta, en lugar
de actuar sobre la cuenta vieja en silencio.

## Resumen de una frase

Cuenta nueva significa proyecto nuevo, almacén nuevo, cuentas nuevas,
ensamblador nuevo y variables nuevas en Vercel; todo lo demás del
código queda igual.
