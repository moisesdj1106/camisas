import { useEffect, useState } from 'react';
import { apiUrl, assetUrl } from '../api';

const ContentPage = () => {
  const [content, setContent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [slideIndex, setSlideIndex] = useState(0);

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

  const banner = content.find((item) => item.slot === 'banner') || content.find((item) => item.type === 'banner');
  const gallery = content.filter((item) => item.slot === 'gallery' || (!item.slot && item.type === 'image'));
  const videos = content.filter((item) => item.slot === 'video' || item.type === 'video');
  const verticalVideos = videos.slice(0, 2);
  const horizontalVideo = videos[2];

  useEffect(() => {
    if (gallery.length < 2) return undefined;
    const timer = window.setInterval(() => setSlideIndex((current) => (current + 1) % gallery.length), 4500);
    return () => window.clearInterval(timer);
  }, [gallery.length]);

  useEffect(() => {
    if (slideIndex >= gallery.length) setSlideIndex(0);
  }, [gallery.length, slideIndex]);

  const renderMedia = (item, options = {}) => {
    if (!item) return null;
    return item.type === 'video'
      ? <video src={assetUrl(item.media_url)} controls={options.controls !== false} autoPlay={options.autoPlay} muted={options.autoPlay} loop={options.autoPlay} playsInline />
      : <img src={assetUrl(item.media_url)} alt={item.title || 'Contenido de MDJ Soccer'} />;
  };

  const slide = gallery[slideIndex];

  return (
    <main className="content-page">
      <section className="content-page__hero">
        <p className="eyebrow">MDJ Soccer · Comunidad y novedades</p>
        <h2>Vive la camiseta más allá del catálogo</h2>
        <p>Descubre promociones, lanzamientos, videos y momentos de nuestra tienda.</p>
      </section>

      {loading ? <div className="empty-state">Cargando contenido...</div> : null}
      {!loading && !content.length ? <div className="empty-state"><h3>Aún no hay contenido publicado</h3><p>Pronto encontrarás novedades de la tienda aquí.</p></div> : null}
      <section className="visual-template" aria-label="Contenido visual de la tienda">
        <article className="visual-slot visual-slot--banner">
          {banner ? <><div className="visual-slot__media">{renderMedia(banner)}</div><div className="visual-slot__copy">{banner.title ? <h3>{banner.title}</h3> : null}{banner.description ? <p>{banner.description}</p> : null}{banner.link_url ? <a href={banner.link_url} target="_blank" rel="noreferrer">Ver promoción</a> : null}</div></> : <div className="visual-slot__empty">Aquí aparecerá tu banner principal</div>}
        </article>

        <article className="visual-slot visual-slot--gallery">
          <div className="visual-slot__heading"><div><span className="content-gallery__type">Colección visual</span><h3>En el foco</h3></div>{gallery.length > 1 ? <span className="visual-counter">{slideIndex + 1} / {gallery.length}</span> : null}</div>
          {gallery.length ? <div className="visual-carousel"><button type="button" className="visual-carousel__arrow" onClick={() => setSlideIndex((slideIndex - 1 + gallery.length) % gallery.length)} aria-label="Foto anterior">‹</button><div className="visual-carousel__media">{renderMedia(slide)}<div className="visual-carousel__overlay"><span>MDJ / DROP</span>{slide?.title ? <strong>{slide.title}</strong> : null}</div></div><button type="button" className="visual-carousel__arrow" onClick={() => setSlideIndex((slideIndex + 1) % gallery.length)} aria-label="Foto siguiente">›</button></div> : <div className="visual-slot__empty">Aquí aparecerán las fotos del carrusel</div>}
          {slide?.description ? <p className="visual-slot__caption">{slide.description}</p> : null}
        </article>

        <article className="visual-slot visual-slot--video">
          <div className="visual-slot__heading"><div><span className="content-gallery__type">Play / now</span><h3>La camiseta en movimiento</h3></div><span className="visual-video__live">● AUTOPLAY</span></div>
          {videos.length ? (
            <div className="video-mosaic">
              <div className="video-mosaic__verticals">
                {verticalVideos.map((item) => <div className="video-tile video-tile--vertical" key={item.id}>{renderMedia(item, { autoPlay: true })}</div>)}
                {!verticalVideos.length ? <div className="visual-slot__empty">Aquí aparecerán los videos verticales</div> : null}
              </div>
              <div className="video-tile video-tile--horizontal">{horizontalVideo ? renderMedia(horizontalVideo, { autoPlay: true }) : <div className="visual-slot__empty">Aquí aparecerá el video horizontal</div>}</div>
            </div>
          ) : <div className="visual-slot__empty">Aquí aparecerán tus videos destacados</div>}
        </article>
      </section>
    </main>
  );
};

export default ContentPage;