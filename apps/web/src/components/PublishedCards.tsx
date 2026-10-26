import { Link } from 'react-router-dom';
import type { PublishedWork } from '../lib/publications';
import { useLanguage } from '../lib/appContext';

export default function PublishedCards({works}:{works:PublishedWork[]}){
  const en=useLanguage()==='en';return <div className="k-grid k-grid--characters">{works.map(work=><article key={work.id} className="k-card" style={{padding:16,overflowWrap:'anywhere'}}><h3><Link to={`/published/${encodeURIComponent(work.id)}`}>{work.name}</Link></h3><p>{work.author_name} · {work.rating==='adult'?(en?'Adult':'成人区分'):(en?'General':'一般')}</p><p>{work.description}</p><p>{work.tags.join(' · ')}</p><small>{en?'Fixed version':'固定版'} {work.revision}</small></article>)}</div>;
}
