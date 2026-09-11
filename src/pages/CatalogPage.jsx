import { useEffect, useState } from 'react';
import { apiUrl } from '../api';
import Modal from '../components/Modal';

const typeLabels = {
  local: 'Local',
  visitante: 'Visitante',
  tercera: 'Tercera'
};

const formatCurrency = (value, currency = 'USD') => {
  const amount = Number(value || 0);
  return currency === 'BS'
    ? `BS ${amount.toLocaleString('es-VE', { maximumFractionDigits: 2 })}`
    : `$${amount.toLocaleString('es-VE', { maximumFractionDigits: 2 })}`;
};

const spotlightVideos = ['/video1.mp4', '/video2.mp4', '/video6.mp4', '/video5.mp4'];
const sizeOptions = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

export const CatalogPage = ({ user, onAddToCart }) => {
  const [products, setProducts] = useState([]);
  const [clubs, setClubs] = useState([]);
  const [availableTypes, setAvailableTypes] = useState([]);
  const [filters, setFilters] = useState({ q: '', club: '', type: '', minPrice: '', maxPrice: '' });
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [dorsal, setDorsal] = useState('');
  const [size, setSize] = useState('');
  const [dorsalMode, setDorsalMode] = useState('none');
  const [customName, setCustomName] = useState('');
  const [customNumber, setCustomNumber] = useState('');
  const [quantities, setQuantities] = useState({});
  const [selectedQuantity, setSelectedQuantity] = useState(1);
  const [exchangeRate, setExchangeRate] = useState(36);
  const [feedbackModal, setFeedbackModal] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [productsResponse, rateResponse] = await Promise.all([
          fetch(apiUrl('/api/products')),
          fetch(apiUrl('/api/admin/exchange-rate'), { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
        ]);
        const data = await productsResponse.json();
        const rateData = await rateResponse.json().catch(() => ({ exchangeRate: 36 }));
        const normalizedProducts = Array.isArray(data) ? data : [];
        const uniqueClubs = [...new Map(normalizedProducts.filter((product) => product.club).map((product) => [product.club.id, product.club])).values()];
        const uniqueTypes = [...new Set(normalizedProducts.map((product) => product.type).filter(Boolean))];
        setProducts(normalizedProducts);
        setClubs(uniqueClubs);
        setAvailableTypes(uniqueTypes);
        setExchangeRate(Number(rateData.exchangeRate || 36));
      } catch (error) {
        console.error('No se pudieron cargar los productos', error);
      }
    };
    load();
  }, []);

  const filtered = products.filter((product) => {
    const matchesQ = !filters.q || product.title.toLowerCase().includes(filters.q.toLowerCase());
    const matchesClub = !filters.club || product.club_id === Number(filters.club);
    const matchesType = !filters.type || product.type === filters.type;
    const matchesMin = !filters.minPrice || Number(product.price) >= Number(filters.minPrice);
    const matchesMax = !filters.maxPrice || Number(product.price) <= Number(filters.maxPrice);
    return matchesQ && matchesClub && matchesType && matchesMin && matchesMax;
  });

  const stockTotal = products.reduce((sum, product) => sum + Number(product.stock || 0), 0);
  const featuredClubs = clubs.slice(0, 3);

  const openDetail = async (productId) => {
    const response = await fetch(apiUrl(`/api/products/${productId}`));
    const data = await response.json();
    setSelectedProduct(data);
    setDorsal('');
    setSize('');
    setDorsalMode('none');
    setCustomName('');
    setCustomNumber('');
    setSelectedQuantity(1);
  };

  const updateQuantity = (productId, value) => {
    const safeValue = Math.max(1, Number(value) || 1);
    setQuantities((current) => ({ ...current, [productId]: safeValue }));
  };

  const getProductImages = (product) => {
    if (Array.isArray(product.image_urls) && product.image_urls.length) return product.image_urls;
    return [product.image_url || 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=800&q=80'];
  };

  const getAvailableSizes = (product) => {
    if (Number(product?.stock || 0) <= 0) return [];
    const stockBySize = product?.stock_by_size || {};
    return sizeOptions.filter((option) => Number(stockBySize[option]) > 0);
  };

  return (
    <div className="catalog-page">
      <section className="hero-banner">
        <div className="hero-banner__content">
          <p className="eyebrow">Colección oficial • Productos en Tendencia</p>
          <h2>Tenemos las mejores camisetas de los clubes más populares.</h2>
          <p>Vive la experiencia de llevar tu equipo favorito con estilo y calidad. Entregas Fisicas en San Cristóbal - Táchira, Se hacen envios a todo el pais</p>
          <div className="hero-banner__metrics">
            <div>
              <strong>{products.length}</strong>
              <span>Productos activos</span>
            </div>
            <div>
              <strong>{clubs.length}</strong>
              <span>Clubes disponibles</span>
            </div>
            <div>
              <strong>{stockTotal}</strong>
              <span>Unidades en stock</span>
            </div>
          </div>
        </div>
      </section>

      <section
        className="hero-spotlight"
        style={{
          backgroundImage: "url('/escudo.jpg')",
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          backgroundColor: '#0f172a'
        }}
      >
        <div className="hero-spotlight__grid">
          <div className="hero-spotlight__copy">
            <p className="eyebrow"></p>
          </div>
          <div className="hero-spotlight__media-stack">
            {spotlightVideos.map((videoSrc, index) => (
              <div
                key={videoSrc}
                className="hero-spotlight__media hero-spotlight__media--wide"
                style={{ backgroundImage: "url('https://images.unsplash.com/photo-1517649763962-0c623066013b?auto=format&fit=crop&w=900&q=80')" }}
              >
                <video
                  key={videoSrc}
                  autoPlay
                  muted
                  playsInline
                  loop
                  poster="https://images.unsplash.com/photo-1517649763962-0c623066013b?auto=format&fit=crop&w=900&q=80"
                >
                  <source src={videoSrc} type="video/mp4" />
                </video>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="filters-card">
        <div className="filters-card__header">
          <div>
            <p className="eyebrow">Explora y filtra</p>
            <h3>Encuentra lo que buscas en segundos</h3>
          </div>
          <span className="results-pill">{filtered.length} resultados</span>
        </div>
        <div className="filter-grid">
          <input placeholder="Buscar por nombre del equipo" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
          <select value={filters.club} onChange={(e) => setFilters({ ...filters, club: e.target.value })}>
            <option value="">Todos los clubes</option>
            {clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}
          </select>
          <select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
            <option value="">Todos los tipos</option>
            {availableTypes.map((type) => <option key={type} value={type}>{typeLabels[type] || type}</option>)}
          </select>
          <input type="number" placeholder="Precio mínimo" value={filters.minPrice} onChange={(e) => setFilters({ ...filters, minPrice: e.target.value })} />
          <input type="number" placeholder="Precio máximo" value={filters.maxPrice} onChange={(e) => setFilters({ ...filters, maxPrice: e.target.value })} />
        </div>
      </section>

      <section className="featured-row">
        {featuredClubs.map((club) => (
          <div key={club.id} className="featured-pill">
            <span>⭐</span>
            <strong>{club.name}</strong>
          </div>
        ))}
      </section>

      {filtered.length ? (
        <div className="grid">
          {filtered.map((product) => {
            const productImages = getProductImages(product);
            return (
            <article className="card product-card" key={product.id}>
              <div className="product-card__image">
                <img src={productImages[0]} alt={product.title} />
              </div>
              <div className="product-card__content">
                <div className="card__meta">
                  <span className="badge">{typeLabels[product.type] || product.type}</span>
                  <span className="stock-pill">{product.stock > 0 ? `${product.stock} disponibles` : 'Sin stock'}</span>
                </div>
                <h3 className="product-card__title">{product.title}</h3>
                <p className="card__club">{product.club?.name || 'Club'}</p>
                <p className="card__description">{product.description || 'Camiseta oficial con diseño premium y detalles exclusivos.'}</p>
                <div className="price-stack">
                  <p className="product-card__price">{formatCurrency(product.price, 'USD')}</p>
                  <p className="price-bs">{formatCurrency(Number(product.price) * exchangeRate, 'BS')}</p>
                </div>
                <div className="quantity-control">
                  <label>Cant.</label>
                  <input type="number" min="1" max="10" value={quantities[product.id] || 1} onChange={(e) => updateQuantity(product.id, e.target.value)} />
                </div>
                <div className="product-card__actions">
                  <button className="ghost-btn" onClick={() => openDetail(product.id)}>Personalizar</button>
                  <button className="primary-btn" onClick={() => {
                    if (!user) return setFeedbackModal({ title: 'Inicia sesión', message: 'Debes iniciar sesión para comprar.' });
                    openDetail(product.id);
                  }}>Comprar</button>
                </div>
              </div>
            </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <h3>No encontramos productos con esos filtros</h3>
          <p>Prueba con otro club, rango de precio o término de búsqueda.</p>
        </div>
      )}

      {selectedProduct ? (
        <div className="modal-backdrop" onClick={() => setSelectedProduct(null)}>
          <div className="modal product-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" type="button" onClick={() => setSelectedProduct(null)} aria-label="Cerrar detalle del producto" title="Cerrar">×</button>
            <div className="product-modal__gallery">
              {(Array.isArray(selectedProduct.image_urls) && selectedProduct.image_urls.length ? selectedProduct.image_urls : [selectedProduct.image_url || 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=800&q=80']).map((image, index) => (
                <img key={`${selectedProduct.id}-${index}`} src={image} alt={`${selectedProduct.title} vista ${index + 1}`} />
              ))}
            </div>
            <div className="product-modal__details">
              <p className="eyebrow">Detalle de producto</p>
              <h3>{selectedProduct.title}</h3>
              <p>{selectedProduct.description}</p>
              <div className="price-stack">
                <p className="price">{formatCurrency(selectedProduct.price, 'USD')}</p>
                <p className="price-bs">{formatCurrency(Number(selectedProduct.price) * exchangeRate, 'BS')}</p>
              </div>
              <p className="card__club">Club: {selectedProduct.club?.name || 'Sin club'}</p>
              <select value={size} onChange={(e) => setSize(e.target.value)}>
                <option value="">Selecciona talla </option>
                {getAvailableSizes(selectedProduct).map((option) => (
                  <option key={option} value={option}>{option}{selectedProduct.stock_by_size?.[option] ? `  - > ${selectedProduct.stock_by_size[option]} disponibles` : ''}</option>
                ))}
              </select>
              {!getAvailableSizes(selectedProduct).length ? <p className="card__description">No hay tallas disponibles para este producto.</p> : null}
              <select value={dorsalMode} onChange={(e) => setDorsalMode(e.target.value)}>
                <option value="none">Sin dorsal</option>
                <option value="catalog">Con dorsal de jugador</option>
                <option value="custom">Camiseta personalizada</option>
              </select>
              {dorsalMode === 'catalog' ? (
                <select value={dorsal} onChange={(e) => setDorsal(e.target.value)}>
                  <option value="">Selecciona dorsal *</option>
                  {selectedProduct.dorsals?.filter((item) => item.is_available).map((item) => (
                    <option key={item.id} value={item.id}>{item.dorsal_number} - {item.player_name || 'Disponible'}</option>
                  ))}
                </select>
              ) : null}
              {dorsalMode === 'custom' ? (
                <div className="customization-fields">
                  <input placeholder="Nombre para la camiseta " value={customName} onChange={(e) => setCustomName(e.target.value)} />
                  <input placeholder="Número para la camiseta " inputMode="numeric" value={customNumber} onChange={(e) => setCustomNumber(e.target.value)} />
                </div>
              ) : null}
              <div className="quantity-control">
                <label>Cantidad</label>
                <input type="number" min="1" max="10" value={selectedQuantity} onChange={(e) => setSelectedQuantity(Math.max(1, Number(e.target.value) || 1))} />
              </div>
              <button className="primary-btn" onClick={() => {
                if (!user) return setFeedbackModal({ title: 'Inicia sesión', message: 'Debes iniciar sesión para comprar.' });
                if (!size) return setFeedbackModal({ title: 'Selecciona una talla', message: 'Selecciona una talla para continuar.' });
                if (!getAvailableSizes(selectedProduct).includes(size)) return setFeedbackModal({ title: 'Talla no disponible', message: 'La talla seleccionada ya no está disponible.' });
                if (selectedProduct.stock_by_size?.[size] && selectedQuantity > Number(selectedProduct.stock_by_size[size])) return setFeedbackModal({ title: 'Cantidad no disponible', message: `Solo hay ${selectedProduct.stock_by_size[size]} unidad(es) en talla ${size}.` });
                if (dorsalMode === 'catalog' && !dorsal) return setFeedbackModal({ title: 'Selecciona un dorsal', message: 'Selecciona un dorsal o elige otra opción.' });
                if (dorsalMode === 'custom' && (!customName.trim() || !customNumber.trim())) return setFeedbackModal({ title: 'Completa la personalización', message: 'Completa el nombre y número de la camiseta personalizada.' });
                const selectedDorsal = selectedProduct.dorsals?.find((item) => String(item.id) === String(dorsal));
                onAddToCart(selectedProduct, dorsalMode === 'catalog' ? selectedDorsal?.dorsal_number || '' : '', selectedQuantity, size, selectedDorsal?.player_name || '', { noDorsal: dorsalMode === 'none', name: dorsalMode === 'custom' ? customName.trim() : '', number: dorsalMode === 'custom' ? customNumber.trim() : '' });
                setSelectedProduct(null);
              }}>Agregar al carrito</button>
            </div>
          </div>
        </div>
      ) : null}
      <Modal open={Boolean(feedbackModal)} title={feedbackModal?.title} message={feedbackModal?.message} onClose={() => setFeedbackModal(null)} />
    </div>
  );
};

export default CatalogPage;
