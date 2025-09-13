const fetch = require('node-fetch');

// Função melhorada para parsing HTML
function parseHTML(html) {
  return {
    querySelectorAll: (selector) => {
      const results = [];
      
      // Buscar links de lojas
      if (selector === 'a[href*="action=viewshop&id="]') {
        const regex = /<a\s+[^>]*href="[^"]*action=viewshop&id=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        while ((match = regex.exec(html)) !== null) {
          results.push({
            getAttribute: (attr) => {
              if (attr === 'href') return `?module=vending&action=viewshop&id=${match[1]}`;
              return null;
            },
            textContent: match[2].replace(/<[^>]*>/g, '').trim()
          });
        }
      }
      
      // Buscar linhas da tabela de itens
      if (selector === 'table.vending tr') {
        const tableRegex = /<table[^>]*class="[^"]*vending[^"]*"[^>]*>([\s\S]*?)<\/table>/i;
        const tableMatch = html.match(tableRegex);
        if (tableMatch) {
          const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
          let rowMatch;
          while ((rowMatch = rowRegex.exec(tableMatch[1])) !== null) {
            if (rowMatch[1].includes('</td>')) {
              results.push({
                querySelectorAll: (tdSelector) => {
                  if (tdSelector === 'td') {
                    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
                    const tds = [];
                    let tdMatch;
                    while ((tdMatch = tdRegex.exec(rowMatch[1])) !== null) {
                      tds.push({
                        textContent: tdMatch[1].replace(/<[^>]*>/g, '').trim()
                      });
                    }
                    return tds;
                  }
                  return [];
                }
              });
            }
          }
        }
      }
      
      // Buscar links de paginação
      if (selector === 'a') {
        const linkRegex = /<a\s+[^>]*href="[^"]*p=(\d+)[^"]*"[^>]*>/gi;
        let linkMatch;
        while ((linkMatch = linkRegex.exec(html)) !== null) {
          results.push({
            getAttribute: (attr) => {
              if (attr === 'href') return `?module=vending&p=${linkMatch[1]}`;
              return null;
            }
          });
        }
      }
      
      return results;
    },
    
    querySelector: (selector) => {
      if (selector === '.pagination') {
        const paginationRegex = /<div[^>]*class="[^"]*pagination[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
        const paginationMatch = html.match(paginationRegex);
        if (paginationMatch) {
          return {
            querySelectorAll: (selector) => {
              if (selector === 'a') {
                const links = [];
                const linkRegex = /<a\s+[^>]*href="[^"]*p=(\d+)[^"]*"[^>]*>/gi;
                let linkMatch;
                while ((linkMatch = linkRegex.exec(paginationMatch[1])) !== null) {
                  links.push({
                    getAttribute: (attr) => {
                      if (attr === 'href') return `?module=vending&p=${linkMatch[1]}`;
                      return null;
                    }
                  });
                }
                return links;
              }
              return [];
            }
          };
        }
      }
      return null;
    }
  };
}

// Função para obter o número total de páginas de mercadores
async function getTotalPages() {
  try {
    console.log('Obtendo total de páginas...');
    const response = await fetch('https://site.heroragnarok.com/?module=vending');
    const html = await response.text();
    const document = parseHTML(html);
    
    const pagination = document.querySelector('.pagination');
    let maxPage = 1;
    
    if (pagination) {
      const pageLinks = pagination.querySelectorAll('a');
      pageLinks.forEach(link => {
        const href = link.getAttribute('href');
        if (href) {
          const match = href.match(/p=(\d+)/);
          if (match) {
            const pageNum = parseInt(match[1]);
            if (pageNum > maxPage) maxPage = pageNum;
          }
        }
      });
    }
    
    console.log(`Total de páginas encontradas: ${maxPage}`);
    return maxPage;
  } catch (error) {
    console.error('Erro ao obter total de páginas:', error);
    return 5; // Fallback para 5 páginas
  }
}

// Função para obter as lojas de uma página específica
async function getStoresFromPage(page) {
  try {
    console.log(`Buscando lojas da página ${page}...`);
    const response = await fetch(`https://site.heroragnarok.com/?module=vending&p=${page}`);
    const html = await response.text();
    const document = parseHTML(html);
    
    const stores = [];
    const storeLinks = document.querySelectorAll('a[href*="action=viewshop&id="]');
    
    storeLinks.forEach(link => {
      const href = link.getAttribute('href');
      const match = href.match(/id=(\d+)/);
      if (match) {
        stores.push({
          id: parseInt(match[1]),
          name: link.textContent || `Loja ${match[1]}`
        });
      }
    });
    
    console.log(`Encontradas ${stores.length} lojas na página ${page}`);
    return stores;
  } catch (error) {
    console.error(`Erro ao obter lojas da página ${page}:`, error);
    return [];
  }
}

// Função para obter os itens de uma loja específica
async function getStoreItems(storeId) {
  try {
    console.log(`Buscando itens da loja ${storeId}...`);
    const response = await fetch(`https://site.heroragnarok.com/?module=vending&action=viewshop&id=${storeId}`);
    const html = await response.text();
    const document = parseHTML(html);
    
    const items = [];
    const rows = document.querySelectorAll('table.vending tr');
    
    // Pular a primeira linha (cabeçalho) se existir
    const startIndex = rows.length > 0 && rows[0].querySelectorAll('td').length > 0 ? 1 : 0;
    
    for (let i = startIndex; i < rows.length; i++) {
      const cols = rows[i].querySelectorAll('td');
      if (cols.length >= 4) {
        // Extrair ID do item - mais robusto
        let itemId = null;
        const idText = cols[0].textContent;
        const idMatch = idText.match(/(\d+)/);
        if (idMatch) itemId = parseInt(idMatch[1]);
        
        // Extrair nome do item
        const itemName = cols[1].textContent;
        
        // Extrair quantidade (pode ter formatação)
        let quantity = 0;
        const qtyText = cols[2].textContent.replace(/[^\d]/g, '');
        if (qtyText) quantity = parseInt(qtyText);
        
        items.push({
          id: itemId,
          name: itemName,
          quantity: quantity,
          price: cols[3].textContent,
          refinement: cols[4] ? cols[4].textContent : '0',
          cards: cols[5] ? cols[5].textContent : '',
          sellType: cols[6] ? cols[6].textContent : 'CASH'
        });
      }
    }
    
    console.log(`Encontrados ${items.length} itens na loja ${storeId}`);
    return items;
  } catch (error) {
    console.error(`Erro ao obter itens da loja ${storeId}:`, error);
    return [];
  }
}

// Handler principal da função Netlify
exports.handler = async (event, context) => {
  // Habilitar CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
  
  // Responder a requisições OPTIONS para CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }
  
  const { item } = event.queryStringParameters;
  if (!item) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Parâmetro "item" é obrigatório' })
    };
  }
  
  try {
    console.log(`=== INICIANDO BUSCA POR: "${item}" ===`);
    
    const isNumericSearch = !isNaN(item);
    let foundItem = null;
    const matchingVendings = [];
    
    // Obter o número total de páginas
    const totalPages = await getTotalPages();
    
    // Verificar cada página
    for (let page = 1; page <= totalPages; page++) {
      console.log(`\n=== VERIFICANDO PÁGINA ${page}/${totalPages} ===`);
      
      const stores = await getStoresFromPage(page);
      
      // Verificar cada loja
      for (const store of stores) {
        try {
          const storeItems = await getStoreItems(store.id);
          
          // Procurar o item nesta loja
          for (const storeItem of storeItems) {
            let matches = false;
            
            if (isNumericSearch) {
              // Busca por ID
              matches = storeItem.id && storeItem.id.toString() === item;
            } else {
              // Busca por nome (case insensitive e parcial)
              matches = storeItem.name && 
                       storeItem.name.toLowerCase().includes(item.toLowerCase());
            }
            
            if (matches) {
              console.log(`✅ ENCONTRADO: ${storeItem.name} (ID: ${storeItem.id}) na loja ${store.name}`);
              
              if (!foundItem) {
                foundItem = {
                  id: storeItem.id,
                  name: storeItem.name
                };
              }
              
              matchingVendings.push({
                store: store.name,
                refinement: storeItem.refinement,
                cards: storeItem.cards,
                price: storeItem.price,
                quantity: storeItem.quantity,
                sellType: storeItem.sellType,
                storeId: store.id
              });
            }
          }
        } catch (error) {
          console.error(`Erro ao processar loja ${store.id}:`, error);
        }
      }
    }
    
    console.log(`\n=== BUSCA FINALIZADA ===`);
    console.log(`Item encontrado: ${foundItem ? foundItem.name : 'Nenhum'}`);
    console.log(`Vendas encontradas: ${matchingVendings.length}`);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        item: foundItem,
        vendings: matchingVendings,
        totalPages: totalPages,
        searchTerm: item,
        timestamp: new Date().toISOString()
      })
    };
  } catch (error) {
    console.error('Erro na função:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Erro interno do servidor',
        message: error.message 
      })
    };
  }
};
