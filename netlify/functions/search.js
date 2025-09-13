const fetch = require('node-fetch');

// Função para fazer parsing do HTML sem usar JSDOM (mais leve)
function parseHTML(html) {
  // Implementação simplificada de parser HTML
  const extractText = (regex, html) => {
    const match = html.match(regex);
    return match ? match[1] : '';
  };

  return {
    querySelectorAll: (selector) => {
      const results = [];
      
      if (selector === 'a[href*="action=viewshop&id="]') {
        const regex = /<a[^>]*href="[^"]*action=viewshop&id=(\d+)[^"]*"[^>]*>([^<]*)<\/a>/g;
        let match;
        while ((match = regex.exec(html)) !== null) {
          results.push({
            getAttribute: (attr) => attr === 'href' ? `?module=vending&action=viewshop&id=${match[1]}` : null,
            textContent: match[2].trim()
          });
        }
      }
      
      if (selector === 'table.vending tr') {
        const regex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
        let match;
        while ((match = regex.exec(html)) !== null) {
          if (match[1].includes('</td>')) {
            results.push({
              querySelectorAll: (tdSelector) => {
                if (tdSelector === 'td') {
                  const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/g;
                  const tds = [];
                  let tdMatch;
                  while ((tdMatch = tdRegex.exec(match[1])) !== null) {
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
      
      return results;
    },
    
    querySelector: (selector) => {
      if (selector === '.pagination') {
        const paginationMatch = html.match(/<div[^>]*class="[^"]*pagination[^"]*"[^>]*>([\s\S]*?)<\/div>/);
        if (paginationMatch) {
          return {
            querySelectorAll: (selector) => {
              if (selector === 'a') {
                const linkRegex = /<a[^>]*href="[^"]*p=(\d+)[^"]*"[^>]*>/g;
                const links = [];
                let linkMatch;
                while ((linkMatch = linkRegex.exec(paginationMatch[1])) !== null) {
                  links.push({
                    getAttribute: (attr) => attr === 'href' ? `?module=vending&p=${linkMatch[1]}` : null
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
    const response = await fetch('https://site.heroragnarok.com/?module=vending');
    const html = await response.text();
    const document = parseHTML(html);
    
    const pagination = document.querySelector('.pagination');
    if (!pagination) return 1;
    
    const pageLinks = pagination.querySelectorAll('a');
    let maxPage = 1;
    
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
    
    return maxPage;
  } catch (error) {
    console.error('Erro ao obter total de páginas:', error);
    return 1;
  }
}

// Função para obter as lojas de uma página específica
async function getStoresFromPage(page) {
  try {
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
          name: link.textContent
        });
      }
    });
    
    return stores;
  } catch (error) {
    console.error(`Erro ao obter lojas da página ${page}:`, error);
    return [];
  }
}

// Função para obter os itens de uma loja específica
async function getStoreItems(storeId) {
  try {
    const response = await fetch(`https://site.heroragnarok.com/?module=vending&action=viewshop&id=${storeId}`);
    const html = await response.text();
    const document = parseHTML(html);
    
    const items = [];
    const rows = document.querySelectorAll('table.vending tr');
    
    // Pular a primeira linha (cabeçalho)
    for (let i = 1; i < rows.length; i++) {
      const cols = rows[i].querySelectorAll('td');
      if (cols.length >= 4) {
        // Extrair ID do item
        let itemId = null;
        const idMatch = cols[0].textContent.match(/(\d+)/);
        if (idMatch) itemId = parseInt(idMatch[1]);
        
        items.push({
          id: itemId,
          name: cols[1].textContent,
          quantity: parseInt(cols[2].textContent) || 0,
          price: cols[3].textContent,
          refinement: cols[4] ? cols[4].textContent : '0',
          cards: cols[5] ? cols[5].textContent : '',
          sellType: cols[6] ? cols[6].textContent : 'CASH'
        });
      }
    }
    
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
    console.log(`Iniciando busca por: ${item}`);
    
    const isNumericSearch = !isNaN(item);
    let foundItem = null;
    const matchingVendings = [];
    
    // Obter o número total de páginas
    const totalPages = await getTotalPages();
    console.log(`Total de páginas encontradas: ${totalPages}`);
    
    // Verificar cada página
    for (let page = 1; page <= totalPages; page++) {
      console.log(`Verificando página ${page} de ${totalPages}`);
      
      const stores = await getStoresFromPage(page);
      console.log(`Encontradas ${stores.length} lojas na página ${page}`);
      
      // Verificar cada loja
      for (const store of stores) {
        try {
          const storeItems = await getStoreItems(store.id);
          
          // Procurar o item nesta loja
          for (const storeItem of storeItems) {
            const matches = isNumericSearch 
              ? storeItem.id && storeItem.id.toString() === item
              : storeItem.name && storeItem.name.toLowerCase().includes(item.toLowerCase());
            
            if (matches) {
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
                sellType: storeItem.sellType
              });
            }
          }
        } catch (error) {
          console.error(`Erro ao processar loja ${store.id}:`, error);
        }
      }
    }
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        item: foundItem,
        vendings: matchingVendings,
        totalPages: totalPages
      })
    };
  } catch (error) {
    console.error('Erro na função:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erro interno do servidor' })
    };
  }
};
