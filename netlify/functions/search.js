const fetch = require('node-fetch');
const { JSDOM } = require('jsdom');

// Função auxiliar para fazer scraping de uma página
async function fetchPage(url) {
  try {
    const response = await fetch(url);
    return await response.text();
  } catch (error) {
    console.error(`Erro ao buscar ${url}:`, error);
    return null;
  }
}

// Função para obter o número total de páginas de mercadores
async function getTotalPages() {
  try {
    const html = await fetchPage('https://site.heroragnarok.com/?module=vending');
    if (!html) return 1;
    
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
    // Encontrar o elemento de paginação
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
    const html = await fetchPage(`https://site.heroragnarok.com/?module=vending&p=${page}`);
    if (!html) return [];
    
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
    const stores = [];
    const storeLinks = document.querySelectorAll('a[href*="action=viewshop&id="]');
    
    storeLinks.forEach(link => {
      const href = link.getAttribute('href');
      const match = href.match(/id=(\d+)/);
      if (match) {
        stores.push({
          id: parseInt(match[1]),
          name: link.textContent.trim()
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
    const html = await fetchPage(`https://site.heroragnarok.com/?module=vending&action=viewshop&id=${storeId}`);
    if (!html) return [];
    
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
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
          name: cols[1].textContent.trim(),
          quantity: parseInt(cols[2].textContent) || 0,
          price: cols[3].textContent.trim(),
          refinement: cols[4] ? cols[4].textContent.trim() : '0',
          cards: cols[5] ? cols[5].textContent.trim() : '',
          sellType: cols[6] ? cols[6].textContent.trim() : 'CASH'
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
    
    // Limitar para 3 páginas para evitar timeout no Netlify
    // Em produção, você pode aumentar este número ou implementar um cache
    const pagesToCheck = Math.min(totalPages, 3);
    
    // Verificar cada página
    for (let page = 1; page <= pagesToCheck; page++) {
      console.log(`Verificando página ${page} de ${pagesToCheck}`);
      
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
        totalPagesChecked: pagesToCheck
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