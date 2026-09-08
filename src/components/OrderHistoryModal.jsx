import { useEffect, useState } from 'react';
import { apiUrl } from '../api';

const statusLabels = {
  pending: 'En revisión',
  approved: 'Aprobado',
  requires_info: 'Requiere información',
  preparing: 'En preparación',
  ready_pickup: 'Listo para retirar',
  shipped: 'Enviado',
  delivered: 'Entregado',
  rejected: 'Rechazado',
  cancelled: 'Cancelado'
};

const statusDescriptions = {
  pending: 'Tu pedido está pendiente de revisión por el administrador.',
  approved: 'Tu pedido fue aprobado y está listo para continuar.',
  requires_info: 'El administrador necesita información adicional sobre tu pedido.',
  preparing: 'Tu pedido está siendo preparado.',
  ready_pickup: 'Tu pedido está listo para retirar.',
  shipped: 'Tu pedido fue enviado.',
  delivered: 'Tu pedido aparece como entregado.',
  rejected: 'Tu pedido fue rechazado. Revisa los detalles o intenta nuevamente.',
  cancelled: 'Tu pedido fue cancelado.'
};

const paymentMethodLabels = {
  whatsapp: 'WhatsApp',
  pago_movil: 'Pago Móvil'
};

const statusClassName = (status) => {
  if (['approved', 'preparing', 'ready_pickup', 'shipped', 'delivered'].includes(status)) return 'status-badge status-badge--approved';
  if (['rejected', 'cancelled'].includes(status)) return 'status-badge status-badge--rejected';
  return 'status-badge status-badge--pending';
};

const ORDERS_PER_PAGE = 4;

const OrderHistoryModal = ({ open, onClose, user }) => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!open || !user?.id) return;
    setPage(1);

    const loadOrders = async (showLoading = false) => {
      if (showLoading) setLoading(true);
      const token = localStorage.getItem('token');
      try {
        const response = await fetch(apiUrl('/api/orders/mine'), {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (response.ok) {
          const data = await response.json();
          setOrders(Array.isArray(data) ? data : []);
        }
      } catch (error) {
        console.error('No se pudieron cargar los pedidos', error);
      } finally {
        if (showLoading) setLoading(false);
      }
    };

    loadOrders(true);
    const refreshTimer = window.setInterval(() => loadOrders(), 10000);
    return () => window.clearInterval(refreshTimer);
  }, [open, user?.id]);

  if (!open) return null;

  const totalPages = Math.max(1, Math.ceil(orders.length / ORDERS_PER_PAGE));
  const startIndex = (page - 1) * ORDERS_PER_PAGE;
  const visibleOrders = orders.slice(startIndex, startIndex + ORDERS_PER_PAGE);
  const summary = {
    pending: orders.filter((order) => order.status === 'pending').length,
    approved: orders.filter((order) => order.status === 'approved').length,
    rejected: orders.filter((order) => order.status === 'rejected').length
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal orders-modal" onClick={(e) => e.stopPropagation()}>
        <div className="orders-modal__header">
          <div>
            <p className="eyebrow">Tu historial</p>
            <h3>Mis pedidos</h3>
          </div>
          <button className="ghost-btn" onClick={onClose}>✕</button>
        </div>

        {loading ? <p style={{ color: '#64748b' }}>Cargando tus pedidos...</p> : null}

        {!loading && !orders.length ? (
          <div className="empty-state" style={{ marginTop: '0.8rem' }}>
            <p style={{ margin: 0 }}>Aún no tienes pedidos registrados.</p>
          </div>
        ) : null}

        {!loading && orders.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.7rem' }}>
            <span className="status-badge status-badge--pending">En revisión: {summary.pending}</span>
            <span className="status-badge status-badge--approved">Aprobados: {summary.approved}</span>
            <span className="status-badge status-badge--rejected">Rechazados: {summary.rejected}</span>
          </div>
        ) : null}

        <div className="orders-list">
          {visibleOrders.map((order) => (
            <article key={order.id} className="order-card">
              <div className="order-card__top">
                <div>
                  <strong>Pedido #{order.id}</strong>
                  <p>{new Date(order.created_at).toLocaleString('es-VE')}</p>
                </div>
                <span className={statusClassName(order.status)}>{statusLabels[order.status] || order.status}</span>
              </div>
              <div className="order-card__meta">
                <span>Total: ${Number(order.total_amount || 0).toFixed(2)}</span>
                <span>Método: {paymentMethodLabels[order.payment_method] || order.payment_method || '—'}</span>
              </div>
              <p style={{ margin: '0.45rem 0 0', color: '#64748b', fontSize: '0.92rem' }}>{statusDescriptions[order.status] || 'Estado pendiente de revisión.'}</p>
              <div className="order-progress" aria-label="Progreso del pedido">
                {['pending', 'approved', 'preparing', order.delivery_method === 'national' ? 'shipped' : 'ready_pickup', 'delivered'].map((step) => (
                  <span key={step} className={step === order.status ? 'order-progress__step order-progress__step--active' : 'order-progress__step'}>{statusLabels[step]}</span>
                ))}
              </div>
              <a className="order-whatsapp-link" href={`https://wa.me/584147146602?text=${encodeURIComponent(`Hola, consulto el estado de mi pedido #${order.id} de MDJ Soccer.`)}`} target="_blank" rel="noreferrer">Contactar por WhatsApp</a>
              {order.items?.length ? (
                <div className="order-items-block">
                  <strong>Productos</strong>
                  <ul className="order-items-list">
                    {order.items.map((item) => (
                      <li key={item.id}>
                        <span>{item.product_title || 'Producto'}</span>
                        <span>× {item.quantity}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </article>
          ))}
        </div>

        {orders.length > ORDERS_PER_PAGE ? (
          <div className="orders-pagination">
            <button className="ghost-btn" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>
              Anterior
            </button>
            <span>Página {page} de {totalPages}</span>
            <button className="ghost-btn" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page === totalPages}>
              Siguiente
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default OrderHistoryModal;
