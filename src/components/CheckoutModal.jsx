import { useEffect, useMemo, useState } from 'react';
import { apiUrl } from '../api';

const paymentDetails = {
  whatsapp: {
    title: 'WhatsApp',
    number: '+58 0414-7146602',
    message: 'Envíanos tu usuario y comprobante por WhatsApp para confirmar el pago, el monto en bs es el indicado en la pagina a la tasa del dia actual.'
  },
  pago_movil: {
    title: 'Pago Móvil',
    number: 'Bco Vzla',
    message: 'CI: V-31.800.900 · Responsable: MDJ Soccer · 0414-714-6602 * Sube tu comprobante de pago para confirmar tu pedido.'
  }
};

const whatsappNumber = '584147146602';

const formatCurrency = (value, currency = 'USD') => {
  const amount = Number(value || 0);
  return currency === 'BS'
    ? `BS ${amount.toLocaleString('es-VE', { maximumFractionDigits: 2 })}`
    : `$${amount.toLocaleString('es-VE', { maximumFractionDigits: 2 })}`;
};

const CheckoutModal = ({ open, onClose, cart, user, onRemoveFromCart, onClearCart, onOrderSubmitted }) => {
  const [paymentMethod, setPaymentMethod] = useState('whatsapp');
  const [proofUrl, setProofUrl] = useState('');
  const [proofFile, setProofFile] = useState(null);
  const [proofPreview, setProofPreview] = useState('');
  const [status, setStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [exchangeRate, setExchangeRate] = useState(36);
  const [deliveryMethod, setDeliveryMethod] = useState('personal');
  const [shippingDetails, setShippingDetails] = useState({
    name: user?.name || '',
    phone: user?.phone || '',
    state: '',
    city: '',
    address: '',
    reference: ''
  });

  const total = useMemo(() => cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1), 0), [cart]);
  const totalBs = useMemo(() => total * exchangeRate, [total, exchangeRate]);

  useEffect(() => {
    if (!open) return;

    const loadExchangeRate = async () => {
      try {
        const response = await fetch(apiUrl('/api/admin/exchange-rate'), {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        });
        if (response.ok) {
          const data = await response.json();
          setExchangeRate(Number(data.exchangeRate || 36));
        }
      } catch (error) {
        console.error('No se pudo cargar la tasa de cambio', error);
      }
    };

    loadExchangeRate();
  }, [open]);

  if (!open) return null;

  const submitOrder = async () => {
    if (!cart.length) {
      setStatus('Tu carrito está vacío. Agrega al menos una camiseta para continuar.');
      return;
    }
    if (!user) {
      setStatus('Debes iniciar sesión antes de confirmar un pedido.');
      return;
    }
    if (deliveryMethod === 'national' && (!shippingDetails.name.trim() || !shippingDetails.phone.trim() || !shippingDetails.state.trim() || !shippingDetails.city.trim() || !shippingDetails.address.trim())) {
      setStatus('Para el envío nacional debes completar nombre, teléfono, estado, ciudad y dirección.');
      return;
    }

    setSubmitting(true);
    setStatus('');

    const whatsappWindow = deliveryMethod === 'national' ? window.open('', '_blank') : null;

    const formData = new FormData();
    formData.append('items', JSON.stringify(cart.map((item) => ({
      product_id: item.id,
      size: item.selectedSize || null,
      dorsal_number: item.selectedDorsal || null,
      dorsal_name: item.selectedDorsal ? `Dorsal ${item.selectedDorsal}` : null,
      quantity: item.quantity || 1,
      unit_price: item.price
    }))));
    formData.append('payment_method', paymentMethod);
    formData.append('delivery_method', deliveryMethod);
    if (deliveryMethod === 'national') {
      formData.append('shipping_details', JSON.stringify(shippingDetails));
    }
    if (proofFile) {
      formData.append('proof', proofFile);
    }
    if (proofUrl.trim()) {
      formData.append('payment_proof_url', proofUrl.trim());
    }

    try {
      const response = await fetch(apiUrl('/api/orders'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: formData
      });

      let data = null;
      try {
        data = await response.json();
      } catch (error) {
        data = { error: 'No se pudo procesar la respuesta del servidor.' };
      }

      if (!response.ok) {
        setStatus(data.error || 'No se pudo procesar el pedido.');
        return;
      }

      if (data.invoiceBuffer) {
        const byteCharacters = atob(data.invoiceBuffer);
        const byteNumbers = new Array(byteCharacters.length).fill(0).map((_, index) => byteCharacters.charCodeAt(index));
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `factura-pedido-${data.order?.id || 'nuevo'}.pdf`;
        link.click();
        URL.revokeObjectURL(url);
      }
      setStatus('Tu pedido está en revisión. Espera la aprobación y recibirás una notificación cuando sea aprobado.');
      setProofUrl('');
      setProofFile(null);
      setProofPreview('');
      onClearCart();
      onClose();
      onOrderSubmitted?.(data.order?.id);
      if (whatsappWindow) {
        const orderLines = cart.map((item) => `${item.title} · Talla ${item.selectedSize} x${item.quantity || 1}`).join(', ');
        const message = [
          `Hola, quiero coordinar el envío nacional de mi pedido #${data.order?.id || ''} de MDJ Soccer.`,
          `Productos: ${orderLines}.`,
          `Nombre: ${shippingDetails.name}`,
          `Teléfono: ${shippingDetails.phone}`,
          `Estado: ${shippingDetails.state}`,
          `Ciudad: ${shippingDetails.city}`,
          `Dirección: ${shippingDetails.address}`,
          shippingDetails.reference ? `Referencia: ${shippingDetails.reference}` : ''
        ].filter(Boolean).join('\n');
        whatsappWindow.location.href = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;
      }
    } catch (error) {
      whatsappWindow?.close();
      setStatus('No se pudo conectar con el servidor.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Checkout</h3>
        {user ? <p>Cliente: {user.name}</p> : <p>Debes iniciar sesión</p>}
        <div style={{ marginBottom: '0.75rem' }}>
          <p className="price" style={{ marginBottom: '0.2rem' }}>Total: {formatCurrency(total, 'USD')}</p>
          <p className="price-bs">≈ {formatCurrency(totalBs, 'BS')} · Tasa actual: {exchangeRate} BS/USD</p>
        </div>
        {cart.length ? (
          <ul>
            {cart.map((item, index) => {
              const lineTotal = Number(item.price || 0) * Number(item.quantity || 1);
              const lineTotalBs = lineTotal * exchangeRate;
              return (
                <li key={index} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.5rem' }}>
                  <span>
                    {item.title} · Talla {item.selectedSize || 'No indicada'} · {item.quantity || 1} und. · {formatCurrency(lineTotal, 'USD')}<br />
                    <small className="price-bs">{formatCurrency(lineTotalBs, 'BS')}</small>
                  </span>
                  <button className="ghost-btn" onClick={() => onRemoveFromCart(index)}>Eliminar</button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p style={{ color: '#64748b' }}>Tu carrito está vacío.</p>
        )}
        <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
          <option value="whatsapp">WhatsApp</option>
          <option value="pago_movil">Pago Móvil</option>
        </select>
        <div className="card" style={{ padding: '0.8rem', marginTop: '0.5rem' }}>
          <strong>{paymentDetails[paymentMethod].title}</strong>
          <p style={{ margin: '0.3rem 0 0' }}>{paymentDetails[paymentMethod].number}</p>
          <p style={{ margin: '0.25rem 0 0', color: '#64748b' }}>{paymentDetails[paymentMethod].message}</p>
        </div>
        <fieldset className="delivery-options">
          <legend>¿Cómo deseas recibir tu pedido?</legend>
          <label>
            <input type="radio" name="delivery-method" value="personal" checked={deliveryMethod === 'personal'} onChange={() => setDeliveryMethod('personal')} />
            Entrega personal en San Cristóbal
          </label>
          <label>
            <input type="radio" name="delivery-method" value="national" checked={deliveryMethod === 'national'} onChange={() => setDeliveryMethod('national')} />
            Envío nacional a cualquier estado de Venezuela
          </label>
        </fieldset>
        {deliveryMethod === 'national' ? (
          <div className="shipping-form">
            <p className="shipping-form__hint">Completa estos datos para coordinar el envío por WhatsApp.</p>
            <input placeholder="Nombre completo *" value={shippingDetails.name} onChange={(e) => setShippingDetails({ ...shippingDetails, name: e.target.value })} />
            <input placeholder="Teléfono de contacto *" value={shippingDetails.phone} onChange={(e) => setShippingDetails({ ...shippingDetails, phone: e.target.value })} />
            <div className="shipping-form__row">
              <input placeholder="Estado *" value={shippingDetails.state} onChange={(e) => setShippingDetails({ ...shippingDetails, state: e.target.value })} />
              <input placeholder="Ciudad *" value={shippingDetails.city} onChange={(e) => setShippingDetails({ ...shippingDetails, city: e.target.value })} />
            </div>
            <textarea placeholder="Dirección de entrega *" value={shippingDetails.address} onChange={(e) => setShippingDetails({ ...shippingDetails, address: e.target.value })} />
            <input placeholder="Punto de referencia (opcional)" value={shippingDetails.reference} onChange={(e) => setShippingDetails({ ...shippingDetails, reference: e.target.value })} />
          </div>
        ) : null}
        <label style={{ display: 'block', marginTop: '0.75rem', color: '#334155', fontSize: '0.95rem' }}>
          Adjuntar comprobante de pago (imagen)
          <input type="file" accept="image/*" onChange={(event) => {
            const file = event.target.files?.[0] || null;
            setProofFile(file);
            if (file) {
              const previewUrl = URL.createObjectURL(file);
              setProofPreview(previewUrl);
            } else {
              setProofPreview('');
            }
          }} style={{ display: 'block', marginTop: '0.4rem' }} />
        </label>
        {proofPreview ? <img src={proofPreview} alt="Vista previa del comprobante" style={{ width: '100%', maxHeight: '180px', objectFit: 'cover', borderRadius: '8px', marginTop: '0.6rem' }} /> : null}
        <textarea placeholder="Añade el nombre y dorsal que llevará tu camiseta, si deseas personalizarla" value={proofUrl} onChange={(e) => setProofUrl(e.target.value)} style={{ marginTop: '0.75rem' }} />
        <button className="primary-btn" onClick={submitOrder} disabled={submitting || !cart.length}>
          {submitting ? 'Procesando...' : 'Confirmar pedido'}
        </button>
        {status ? <p>{status}</p> : null}
      </div>
    </div>
  );
};

export default CheckoutModal;
