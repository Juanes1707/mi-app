import type { Post } from '@/features/feed/domain/entities/post';

export const MOCK_POSTS: readonly Post[] = [
  {
    id: 'post-001',
    author: {
      id: 'author-001',
      username: 'maria.enruta',
      displayName: 'María Rodríguez',
      avatarUrl:
        'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=160&h=160&fit=crop&crop=face',
    },
    imageUrl:
      'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&h=1200&fit=crop',
    caption: 'Un descanso frente al mar para empezar la semana con calma.',
    createdAt: '2026-09-29T15:30:00.000Z',
    likeCount: 248,
    commentCount: 18,
  },
  {
    id: 'post-002',
    author: {
      id: 'author-002',
      username: 'santi.camina',
      displayName: 'Santiago Ruiz',
      avatarUrl:
        'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=160&h=160&fit=crop&crop=face',
    },
    imageUrl:
      'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1200&h=1200&fit=crop',
    caption: 'La recompensa de madrugar: montaña, silencio y aire frío.',
    createdAt: '2026-09-27T11:15:00.000Z',
    likeCount: 731,
    commentCount: 42,
  },
  {
    id: 'post-003',
    author: {
      id: 'author-003',
      username: 'vale.crea',
      displayName: 'Valentina Castro',
      avatarUrl:
        'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=160&h=160&fit=crop&crop=face',
    },
    imageUrl:
      'https://images.unsplash.com/photo-1533105079780-92b9be482077?w=1200&h=1200&fit=crop',
    caption: 'Colores que encontré caminando sin mapa por la ciudad.',
    createdAt: '2026-09-25T20:40:00.000Z',
    likeCount: 519,
    commentCount: 31,
  },
  {
    id: 'post-004',
    author: {
      id: 'author-004',
      username: 'nico.foto',
      displayName: 'Nicolás Herrera',
      avatarUrl:
        'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=160&h=160&fit=crop&crop=face',
    },
    imageUrl:
      'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?w=1200&h=1200&fit=crop',
    caption: 'Una tarde tranquila junto al lago. Guardaría esta luz para siempre.',
    createdAt: '2026-09-22T17:05:00.000Z',
    likeCount: 892,
    commentCount: 57,
  },
  {
    id: 'post-005',
    author: {
      id: 'author-005',
      username: 'laura.verde',
      displayName: 'Laura Gómez',
      avatarUrl:
        'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=160&h=160&fit=crop&crop=face',
    },
    imageUrl:
      'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1200&h=1200&fit=crop',
    caption: 'Volver al bosque también es una forma de volver a uno mismo.',
    createdAt: '2026-09-19T13:20:00.000Z',
    likeCount: 364,
    commentCount: 24,
  },
  {
    id: 'post-006',
    author: {
      id: 'author-006',
      username: 'diego.afuera',
      displayName: 'Diego Martínez',
      avatarUrl:
        'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=160&h=160&fit=crop&crop=face',
    },
    imageUrl:
      'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1200&h=1200&fit=crop',
    caption: 'Kilómetros de paisaje y todavía quedan ganas de seguir.',
    createdAt: '2026-09-16T09:10:00.000Z',
    likeCount: 1102,
    commentCount: 76,
  },
  {
    id: 'post-007',
    author: {
      id: 'author-007',
      username: 'ana.descubre',
      displayName: 'Ana López',
      avatarUrl:
        'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=160&h=160&fit=crop&crop=face',
    },
    imageUrl:
      'https://images.unsplash.com/photo-1528181304800-259b08848526?w=1200&h=1200&fit=crop',
    caption: 'Detalles de un lugar que cuenta su historia en cada esquina.',
    createdAt: '2026-09-12T18:45:00.000Z',
    likeCount: 647,
    commentCount: 38,
  },
  {
    id: 'post-008',
    author: {
      id: 'author-008',
      username: 'cami.pausa',
      displayName: 'Camila Torres',
      avatarUrl:
        'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=160&h=160&fit=crop&crop=face',
    },
    imageUrl:
      'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=1200&h=1200&fit=crop',
    caption: 'Un rincón para respirar, leer y dejar pasar la tarde.',
    createdAt: '2026-09-08T14:00:00.000Z',
    likeCount: 423,
    commentCount: 29,
  },
];
