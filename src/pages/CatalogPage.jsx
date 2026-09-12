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
const PRODUCTS_PER_PAGE = 8;

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
  const [currentPage, setCurrentPage] = useState(1);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [zoomedImage, setZoomedImage] = useState(null);
  const [likedProducts, setLikedProducts] = useState({});

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

  useEffect(() => {
    setCurrentPage(1);
  }, [filters.q, filters.club, filters.type, filters.minPrice, filters.maxPrice]);

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
  const totalPages = Math.max(1, Math.ceil(filtered.length / PRODUCTS_PER_PAGE));
  const visibleProducts = filtered.slice((currentPage - 1) * PRODUCTS_PER_PAGE, currentPage * PRODUCTS_PER_PAGE);

  const openDetail = async (productId) => {
    const [productResponse, likeResponse] = await Promise.all([
      fetch(apiUrl(`/api/products/${productId}`)),
      user ? fetch(apiUrl(`/api/products/${productId}/like`), { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }) : Promise.resolve(null)
    ]);
    const data = await productResponse.json();
    if (likeResponse?.ok) {
      const likeData = await likeResponse.json();
      setLikedProducts((current) => ({ ...current, [productId]: likeData.liked }));
    }
    setSelectedProduct(data);
    setActiveImageIndex(0);
    setDorsal('');
    setSize('');
    setDorsalMode('none');
    setCustomName('');
    setCustomNumber('');
    setSelectedQuantity(1);
  };

  const toggleLike = async (productId) => {
    if (!user) return setFeedbackModal({ title: 'Inicia sesión', message: 'Debes iniciar sesión para marcar tus productos favoritos.' });
    try {
      const response = await fetch(apiUrl(`/api/products/${productId}/like`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (!response.ok) return;
      const result = await response.json();
      setLikedProducts((current) => ({ ...current, [productId]: result.liked }));
      setProducts((current) => current.map((product) => product.id === productId ? { ...product, likes_count: result.likes_count } : product));
      setSelectedProduct((current) => current?.id === productId ? { ...current, likes_count: result.likes_count } : current);
    } catch (error) {
      setFeedbackModal({ title: 'No se pudo actualizar', message: 'Intenta nuevamente en unos segundos.' });
    }
  };

  const getSelectedImages = () => getProductImages(selectedProduct || {});

  const moveGallery = (direction) => {
    const images = getSelectedImages();
    setActiveImageIndex((current) => (current + direction + images.length) % images.length);
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
          {visibleProducts.map((product) => {
            const productImages = getProductImages(product);
            return (
            <div className="product-card-shell" key={product.id}>
              <article className="card product-card">
                <button className="product-card__image" type="button" onClick={() => openDetail(product.id)} aria-label={`Ver imágenes de ${product.title}`}>
                  <img src={productImages[0]} alt={product.title} />
                  <span className="product-card__image-hint">Ver galería</span>
                </button>
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
              <button className={`like-button like-button--floating ${likedProducts[product.id] ? 'like-button--active' : ''}`} type="button" onClick={() => toggleLike(product.id)} aria-label={`${likedProducts[product.id] ? 'Quitar me gusta de' : 'Me gusta'} ${product.title}`} title={likedProducts[product.id] ? 'Quitar me gusta' : 'Me gusta'}>
                <span aria-hidden="true">{likedProducts[product.id] ? '♥' : '♡'}</span><small>{Number(product.likes_count || 0)}</small>
              </button>
            </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <h3>No encontramos productos con esos filtros</h3>
          <p>Prueba con otro club, rango de precio o término de búsqueda.</p>
        </div>
      )}

      {filtered.length ? (
        <nav className="catalog-pagination" aria-label="Paginación del catálogo">
          <button className="ghost-btn" type="button" disabled={currentPage === 1} onClick={() => setCurrentPage((page) => page - 1)}>Anterior</button>
          <span>Página {currentPage} de {totalPages}</span>
          <button className="ghost-btn" type="button" disabled={currentPage === totalPages} onClick={() => setCurrentPage((page) => page + 1)}>Siguiente</button>
        </nav>
      ) : null}

      {selectedProduct ? (
        <div className="modal-backdrop" onClick={() => setSelectedProduct(null)}>
          <div className="modal product-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" type="button" onClick={() => setSelectedProduct(null)} aria-label="Cerrar detalle del producto" title="Cerrar">×</button>
            <div className="product-modal__gallery">
              <div className="product-gallery__main">
                <button className="gallery-arrow gallery-arrow--prev" type="button" onClick={() => moveGallery(-1)} aria-label="Imagen anterior">‹</button>
                <button className="gallery-main-image" type="button" onClick={() => setZoomedImage(getSelectedImages()[activeImageIndex])} aria-label="Ampliar imagen">
                  <img src={getSelectedImages()[activeImageIndex]} alt={`${selectedProduct.title} vista ${activeImageIndex + 1}`} />
                  <span>Haz clic para ampliar</span>
                </button>
                <button className="gallery-arrow gallery-arrow--next" type="button" onClick={() => moveGallery(1)} aria-label="Imagen siguiente">›</button>
              </div>
              <div className="product-gallery__thumbs">
                {getSelectedImages().map((image, index) => (
                  <button className={index === activeImageIndex ? 'product-gallery__thumb active' : 'product-gallery__thumb'} type="button" key={`${selectedProduct.id}-${index}`} onClick={() => setActiveImageIndex(index)}>
                    <img src={image} alt={`${selectedProduct.title} miniatura ${index + 1}`} />
                  </button>
                ))}
              </div>
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
              <button className={`like-button like-button--large ${likedProducts[selectedProduct.id] ? 'like-button--active' : ''}`} type="button" onClick={() => toggleLike(selectedProduct.id)} aria-label={likedProducts[selectedProduct.id] ? 'Quitar me gusta' : 'Me gusta'} title={likedProducts[selectedProduct.id] ? 'Quitar me gusta' : 'Me gusta'}>
                <span aria-hidden="true">{likedProducts[selectedProduct.id] ? '♥' : '♡'}</span><small>{Number(selectedProduct.likes_count || 0)}</small>
              </button>
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
      {zoomedImage ? (
        <div className="image-zoom-backdrop" onClick={() => setZoomedImage(null)}>
          <img src={zoomedImage} alt="Vista ampliada del producto" onClick={(event) => event.stopPropagation()} />
          <button className="modal-close" type="button" onClick={() => setZoomedImage(null)} aria-label="Cerrar imagen ampliada">×</button>
        </div>
      ) : null}
      <Modal open={Boolean(feedbackModal)} title={feedbackModal?.title} message={feedbackModal?.message} onClose={() => setFeedbackModal(null)} />
    </div>
  );
};

export default CatalogPage;
