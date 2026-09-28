const directions = [
  "top ajustado y shorts de mezclilla de tiro alto, color acento coral o turquesa",
  "top corto y pantalón entallado, tonos azul y lavanda",
  "minifalda y blusa entallada, tonos verdes o rosa intenso",
  "vestido corto ajustado de color vivo con corte adecuado a la ocasión",
  "chaqueta corta con top ajustado y shorts, tonos terracota o azul",
  "conjunto corto de dos piezas, combinación de estampado y color liso",
];
export function wardrobeDirection(projectId: string, characterId: string, existing: string[]) {
  const hash = Array.from(projectId + ':' + characterId).reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0);
  return `VESTUARIO ORIGINAL: para MUJERES ADULTAS, estética fan service de moda atractiva: prendas cortas o ajustadas que favorecen las curvas naturales, sin desnudez. No aplicar esta pauta a menores; otros personajes se visten según su identidad y edad. Punto de partida para una mujer adulta: ${directions[hash % directions.length]}. Adáptalo a edad, época, lugar, profesión y acción aprobados; una exigencia explícita de la historia tiene prioridad. No impongas vestido blanco, crema o marfil por defecto. Define prendas, colores, tejido, calzado y accesorios concretos. Evita repetir la combinación de otras fichas: ${JSON.stringify(existing)}. Esta variedad se decide SOLO al crear el personaje. Su vestuario definitivo quedará fijo en las tomas y videos; no cambies ropa entre clips ni al regenerar su retrato sin petición del usuario.`;
}
