import { useEffect, useState } from 'react';
import { apiUrl, assetUrl } from '../api';

const ContentPage = () => {
  const [content, setContent] = useState([]);
  const [activeType, setActiveType] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadContent = async () => {
      try {
        const response = await fetch(apiUrl('/api/content'));
        const data = await response.json();
        setContent(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error('No se pudo cargar el contenido de la tienda', error);
      } finally {
        setLoading(false);
      }
    };
    loadContent();
  }, []);

  const visibleContent = activeType === 'all' ? content : content.filter((item) => item.type === activeType);

  return (
    <main className="content-page">
      <section className="content-page__hero">
        <p className="eyebrow">MDJ Soccer · Comunidad y novedades</p>
        <h2>Vive la camiseta más allá del catálogo</h2>
        <p>Descubre promociones, lanzamientos, videos y momentos de nuestra tienda.</p>
      </section>

      <div className="content-page__filters" role="tablist" aria-label="Filtrar contenido">
        {[['all', 'Todo'], ['banner', 'Promociones'], ['image', 'Imágenes'], ['video', 'Videos']].map(([value, label]) => (
          <button key={value} type="button" className={activeType === value ? 'content-filter active' : 'content-filter'} onClick={() => setActiveType(value)}>{label}</button>
        ))}
      </div>

      {loading ? <div className="empty-state">Cargando contenido...</div> : null}
      {!loading && !visibleContent.length ? <div className="empty-state"><h3>Aún no hay contenido publicado</h3><p>Pronto encontrarás novedades de la tienda aquí.</p></div> : null}
      <section className="content-gallery" aria-label="Contenido de la tienda">
        {visibleContent.map((item) => (
          <article className={`content-gallery__item content-gallery__item--${item.type}`} key={item.id}>
            <div className="content-gallery__media">
              {item.type === 'video' ? <video src={assetUrl(item.media_url)} controls playsInline poster={item.poster_url ? assetUrl(item.poster_url) : undefined} /> : <img src={assetUrl(item.media_url)} alt={item.title || 'Contenido de MDJ Soccer'} />}
            </div>
            <div className="content-gallery__copy">
              <span className="content-gallery__type">{item.type === 'video' ? 'Video' : item.type === 'banner' ? 'Promoción' : 'Novedad'}</span>
              {item.title ? <h3>{item.title}</h3> : null}
              {item.description ? <p>{item.description}</p> : null}
              {item.link_url ? <a href={item.link_url} target="_blank" rel="noreferrer">Ver más</a> : null}
            </div>
          </article>
        ))}
      </section>
    </main>
  );
};

export default ContentPage;