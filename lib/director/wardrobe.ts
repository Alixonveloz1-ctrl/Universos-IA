const directions = [
  "camiseta corta de algodón y shorts de mezclilla de tiro alto, zapatillas blancas",
  "top de punto acanalado y jeans actuales de tiro alto, zapatillas casuales",
  "camiseta ajustada y falda corta casual de mezclilla, zapatillas bajas",
  "vestido casual corto de punto, chaqueta de mezclilla ligera y zapatillas",
  "top sencillo de tirantes, pantalón de mezclilla de corte actual y zapatillas",
  "camiseta de algodón entallada, shorts casuales de color y tenis urbanos",
];
export function wardrobeDirection(projectId: string, characterId: string, existing: string[]) {
  const hash = Array.from(projectId + ':' + characterId).reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0);
  return `VESTUARIO ORIGINAL: para MUJERES ADULTAS en una historia contemporánea, moda casual reconocible de hoy, atractiva y ponible en la vida diaria, con prendas de tela de verdad que favorecen su figura de forma natural. Un top corto, una camiseta ajustada, shorts o un vestido casual pueden aportar el atractivo pedido sin disfrazarla ni sexualizar a menores. No aplicar esta pauta a menores; otros personajes se visten según su identidad y edad. Elige una combinación concreta para ESTA mujer partiendo de: ${directions[hash % directions.length]}. Varía los colores y prendas entre personajes sin repetir uniformes; no conviertas el punto de partida en un uniforme obligatorio. Evita blusa formal con falda tubo, traje ejecutivo, zapatos de salón, prendas vintage ochenteras, ropa de gala o fantasía salvo que la historia aprobada exija explícitamente esa ocasión. Una profesión o una situación económica no obliga a ropa formal en su retrato cotidiano. Define prendas, colores, tejido, calzado y accesorios actuales y concretos. Evita repetir la combinación de otras fichas: ${JSON.stringify(existing)}. Si la historia aprobada requiere otra época o un uniforme, respétalo. Esta variedad se decide SOLO al crear el personaje; después conserva su vestuario aprobado exactamente en las tomas y videos y no cambies ropa entre clips ni al regenerar su retrato sin petición del usuario.`;
}
