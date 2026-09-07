import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { apiUrl } from './api';
import AuthPage from './pages/AuthPage';
import CatalogPage from './pages/CatalogPage';
import AdminPage from './pages/AdminPage';
import CheckoutModal from './components/CheckoutModal';
import OrderHistoryModal from './components/OrderHistoryModal';

const getUser = () => {
  const raw = localStorage.getItem('user');
  return raw ? JSON.parse(raw) : null;
};

const App = () => {
  const [user, setUser] = useState(getUser());
  const [cart, setCart] = useState([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [orderReviewOpen, setOrderReviewOpen] = useState(false);
  const [orderWhatsappUrl, setOrderWhatsappUrl] = useState('');
  const [orderHistoryOpen, setOrderHistoryOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const handleStorage = () => setUser(getUser());
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    if (!user?.id) return;

    const loadNotifications = async () => {
      const token = localStorage.getItem('token');
      if (!token) return;
      try {
        const response = await fetch(apiUrl('/api/auth/me/notifications'), {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (response.ok) {
          const data = await response.json();
          setNotifications(Array.isArray(data) ? data : []);
        }
      } catch (error) {
        console.error('No se pudieron cargar las notificaciones', error);
      }
    };

    loadNotifications();
    const timer = window.setInterval(loadNotifications, 10000);
    return () => window.clearInterval(timer);
  }, [user?.id]);

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    navigate('/');
  };

  const addToCart = (product, dorsal, quantity = 1, size, dorsalName = '', customization = {}) => {
    setCart((current) => [...current, { ...product, selectedDorsal: dorsal, selectedDorsalName: dorsalName, selectedSize: size, selectedNoDorsal: Boolean(customization.noDorsal), customName: customization.name || '', customNumber: customization.number || '', quantity: Math.max(1, Number(quantity) || 1) }]);
    setCheckoutOpen(true);
  };

  const removeFromCart = (index) => {
    setCart((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const clearCart = () => {
    setCart([]);
  };

  const handleOrderSubmitted = (_orderId, whatsappUrl = '') => {
    setOrderWhatsappUrl(whatsappUrl);
    setOrderReviewOpen(true);
  };

  const markNotificationRead = async (notificationId) => {
    const token = localStorage.getItem('token');
    try {
      const response = await fetch(apiUrl(`/api/auth/me/notifications/${notificationId}/read`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        setNotifications((current) => current.map((item) => item.id === notificationId ? { ...item, read: true } : item));
      }
    } catch (error) {
      console.error('No se pudo marcar la notificación', error);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img className="brand-logo" src="/loguito.png" alt="Logo de la tienda" />
          <div>
            <h1>MDJ SOCCER</h1>
            <p>Camisetas de clubes de fútbol</p>
          </div>
        </div>
        <nav className="nav-links">
          <Link to="/">Catálogo</Link>
          {user?.role === 'admin' ? (
            <div className="dropdown">
              <button className="ghost-btn dropdown-toggle" onClick={() => setMenuOpen((open) => !open)}>
                Gestión ▾
              </button>
              {menuOpen ? (
                <div className="dropdown-menu">
                  <Link to="/admin?view=overview" onClick={() => setMenuOpen(false)}>Panel admin</Link>
                  <Link to="/admin?view=inventory" onClick={() => setMenuOpen(false)}>Inventario</Link>
                  <Link to="/admin?view=clubs" onClick={() => setMenuOpen(false)}>Clubes</Link>
                </div>
              ) : null}
            </div>
          ) : null}
          {user ? (
            <>
              <button className="ghost-btn" onClick={() => setOrderHistoryOpen(true)}>Mis pedidos</button>
              <div style={{ position: 'relative' }}>
                <button className="ghost-btn" onClick={() => setNotificationsOpen((open) => !open)}>🔔 {notifications.filter((item) => !item.read).length ? `(${notifications.filter((item) => !item.read).length})` : ''}</button>
                {notificationsOpen ? (
                  <div className="card" style={{ position: 'absolute', right: 0, top: 'calc(100% + 0.4rem)', width: '280px', padding: '0.75rem', zIndex: 50 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <strong>Notificaciones</strong>
                      <button className="ghost-btn" onClick={() => setNotificationsOpen(false)}>✕</button>
                    </div>
                    {notifications.length ? notifications.map((item) => {
                      const toneClass = item.type === 'success' ? 'notification-card notification-card--success' : item.type === 'warning' ? 'notification-card notification-card--warning' : 'notification-card';
                      return (
                        <div key={item.id} className={toneClass}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                            <strong>{item.title}</strong>
                            {!item.read ? <button className="ghost-btn" onClick={() => markNotificationRead(item.id)}>Marcar</button> : null}
                          </div>
                          <p>{item.message}</p>
                        </div>
                      );
                    }) : <p style={{ margin: 0, color: '#64748b' }}>No tienes notificaciones.</p>}
                  </div>
                ) : null}
              </div>
              <button className="ghost-btn" onClick={() => setCheckoutOpen(true)}>Carrito ({cart.reduce((sum, item) => sum + Number(item.quantity || 1), 0)})</button>
              <button className="ghost-btn" onClick={logout}>Cerrar sesión</button>
            </>
          ) : (
            <Link to="/auth">Iniciar sesión</Link>
          )}
        </nav>
      </header>

      <Routes>
        <Route path="/" element={<CatalogPage user={user} onAddToCart={addToCart} />} />
        <Route path="/auth" element={user ? <Navigate to="/" replace /> : <AuthPage onAuth={setUser} />} />
        <Route path="/admin" element={user?.role === 'admin' ? <AdminPage /> : <Navigate to="/" replace />} />
      </Routes>

      <CheckoutModal open={checkoutOpen} onClose={() => setCheckoutOpen(false)} cart={cart} user={user} onRemoveFromCart={removeFromCart} onClearCart={clearCart} onOrderSubmitted={handleOrderSubmitted} />

      {orderReviewOpen ? (
        <div className="modal-backdrop" onClick={() => setOrderReviewOpen(false)}>
          <div className="modal review-modal" onClick={(e) => e.stopPropagation()}>
            <div className="review-modal__icon">✓</div>
            <p className="eyebrow">Pedido recibido</p>
            <h3>Tu pedido está en revisión</h3>
            <p>Tu pedido fue enviado correctamente. Está pendiente de aprobación y recibirás una notificación cuando sea aprobado.</p>
            <p className="review-modal__hint">Si la notificación no aparece de inmediato, la página seguirá revisando automáticamente tu estado.</p>
            {orderWhatsappUrl ? <a className="whatsapp-link review-modal__whatsapp" href={orderWhatsappUrl} target="_blank" rel="noreferrer">Coordinar envío por WhatsApp</a> : null}
            <button className="primary-btn" onClick={() => { setOrderReviewOpen(false); setOrderWhatsappUrl(''); }} style={{ marginTop: '0.75rem' }}>Entendido</button>
          </div>
        </div>
      ) : null}

      <OrderHistoryModal open={orderHistoryOpen} onClose={() => setOrderHistoryOpen(false)} user={user} />

      <footer className="footer">
        <div className="footer-content">
          <div>
            <strong>MDJ SOCCER</strong>
            <p>Tienda online de camisetas de fútbol con envíos nacionales a toda Venezuela.</p>
            <p>También realizamos entregas personales en la ciudad de San Cristóbal.</p>
          </div>
          <div className="footer-links">
            <a className="instagram-link" href="https://www.instagram.com/mdj_soccer/" target="_blank" rel="noreferrer" aria-label="Visita MDJ Soccer en Instagram">
              <svg className="instagram-icon" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="5" />
                <circle cx="12" cy="12" r="4" />
                <circle cx="17.5" cy="6.5" r="1" className="instagram-icon__dot" />
              </svg>
              <span>@mdj_soccer</span>
            </a>
            <a className="whatsapp-link" href={`https://wa.me/584147146602?text=${encodeURIComponent('Hola, quiero consultar por las camisetas y los envíos de MDJ Soccer.')}`} target="_blank" rel="noreferrer" aria-label="Contacta con MDJ Soccer por WhatsApp">
              <svg className="whatsapp-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20.5 11.2a8.4 8.4 0 0 1-12.4 7.4L3.5 20l1.5-4.4A8.5 8.5 0 1 1 20.5 11.2Z" />
                <path d="M8.2 8.1c.2-.4.4-.4.7-.4h.5c.2 0 .4.1.5.4l.7 1.7c.1.2.1.4-.1.6l-.6.7c.5 1 1.3 1.8 2.3 2.3l.7-.6c.2-.2.4-.2.6-.1l1.7.7c.3.1.4.3.4.5v.5c0 .3 0 .5-.4.7-.4.2-1 .3-1.4.2-1.3-.3-2.6-.9-3.7-2-1.1-1-1.8-2.3-2.1-3.6-.1-.5 0-1.1.2-1.4Z" />
              </svg>
              <span>WhatsApp</span>
            </a>
            
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
