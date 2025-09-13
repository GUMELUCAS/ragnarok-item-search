// netlify/functions/scrape.js
const fetch = require('node-fetch');
const { JSDOM } = require('jsdom');

// Função para fazer scraping de uma página de mercadores
async function scrapeVendingPage(page = 1) {
    const url = `https://site.heroragnarok.com/?module=vending&p=${page}`;
    const response = await fetch(url);
    const html = await response.text();
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
    // Encontrar todos os links para lojas
    const storeLinks = Array.from(document.querySelectorAll('a[href*="action=viewshop&id="]'));
    
    const results = [];
    for (const link of storeLinks) {
        const href = link.getAttribute('href');
        const idMatch = href.match(/id=(\d+)/);
        if (idMatch) {
            results.push({
                id: parseInt(idMatch[1]),
                name: link.textContent.trim()
            });
        }
    }
    
    // Verificar se há mais páginas
    const nextPageLink = document.querySelector('a:contains("Próximo")');
    const hasNextPage = nextPageLink && !nextPageLink.classList.contains('disabled');
    
    return {
        stores: results,
        hasNextPage: hasNextPage
    };
}

// Função para fazer scraping de uma loja específica
async function scrapeStore(storeId) {
    const url = `https://site.heroragnarok.com/?module=vending&action=viewshop&id=${storeId}`;
    const response = await fetch(url);
    const html = await response.text();
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
    const items = [];
    const rows = document.querySelectorAll('table.vending tr:not(:first-child)');
    
    rows.forEach(row => {
        const cols = row.querySelectorAll('td');
        if (cols.length >= 4) {
            const itemIdMatch = cols[0].textContent.match(/(\d+)/);
            const itemId = itemIdMatch ? parseInt(itemIdMatch[1]) : null;
            
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
    });
    
    // Obter nome da loja
    const storeName = document.querySelector('title')
        ? document.querySelector('title').textContent.split(' - ')[0]
        : `Loja ${storeId}`;
    
    return {
        storeId: storeId,
        storeName: storeName,
        items: items
    };
}

// Função principal
exports.handler = async function(event, context) {
    const { item } = event.queryStringParameters;
    if (!item) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Parâmetro "item" é obrigatório' })
        };
    }
    
    try {
        // 1. Coletar todas as lojas (através de todas as páginas)
        console.log('Coletando lista de lojas...');
        let allStores = [];
        let page = 1;
        let hasNextPage = true;
        
        while (hasNextPage && page <= 10) { // Limite de 10 páginas para evitar timeout
            const pageData = await scrapeVendingPage(page);
            allStores = allStores.concat(pageData.stores);
            hasNextPage = pageData.hasNextPage;
            page++;
            
            // Pequena pausa para não sobrecarregar o servidor
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        console.log(`Encontradas ${allStores.length} lojas`);
        
        // 2. Procurar o item em todas as lojas
        console.log(`Procurando por "${item}" em todas as lojas...`);
        const searchTerm = item.toLowerCase();
        const isNumericSearch = !isNaN(item);
        
        const matchingVendings = [];
        let foundItem = null;
        
        // Verificar apenas as primeiras 50 lojas para evitar timeout
        // Em produção, você precisaria de uma solução mais robusta com cache
        for (let i = 0; i < Math.min(allStores.length, 50); i++) {
            const store = allStores[i];
            console.log(`Verificando loja ${i+1}/${Math.min(allStores.length, 50)}: ${store.name}`);
            
            try {
                const storeData = await scrapeStore(store.id);
                
                for (const storeItem of storeData.items) {
                    const matches = isNumericSearch 
                        ? storeItem.id && storeItem.id.toString() === item
                        : storeItem.name && storeItem.name.toLowerCase().includes(searchTerm);
                    
                    if (matches) {
                        if (!foundItem) {
                            foundItem = {
                                id: storeItem.id,
                                name: storeItem.name
                            };
                        }
                        
                        matchingVendings.push({
                            store: storeData.storeName,
                            refinement: storeItem.refinement,
                            cards: storeItem.cards,
                            price: storeItem.price,
                            quantity: storeItem.quantity,
                            sellType: storeItem.sellType
                        });
                    }
                }
                
                // Pequena pausa para não sobrecarregar o servidor
                await new Promise(resolve => setTimeout(resolve, 500));
                
            } catch (error) {
                console.error(`Erro ao verificar loja ${store.id}:`, error);
            }
        }
        
        return {
            statusCode: 200,
            body: JSON.stringify({
                item: foundItem,
                vendings: matchingVendings
            })
        };
        
    } catch (error) {
        console.error('Erro:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Erro interno do servidor' })
        };
    }
};
