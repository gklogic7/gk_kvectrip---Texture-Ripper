// Atlas & texture metadata JSON generator
import { state } from '../core/app-state.js';

export function buildAtlasMetadata(packedResult) {
  if (!packedResult) return null;
  const atlasW = packedResult.width;
  const atlasH = packedResult.height;
  const pad = state.atlas.padding;

  return {
    generator: 'KVectRip',
    exportedAt: new Date().toISOString(),
    atlas: {
      width: atlasW,
      height: atlasH,
      aspectRatio: state.atlas.aspectRatio || 'auto',
      algorithm: state.atlas.algorithm,
      arrayMode: !!state.atlas.arrayMode,
      overallFilter: state.atlas.fx?.overallFilter || 'none',
      postProcessing: state.atlas.fx?.post?.enabled ? { ...state.atlas.fx.post } : null,
      padding: pad,
      spacing: state.atlas.spacing,
      efficiencyPercent: packedResult.efficiency,
    },
    textures: packedResult.placements.map((p) => {
      const ripper = state.rippers.find((r) => r.id === p.ripperId);
      const srcImg = ripper ? state.images.find((i) => i.id === ripper.sourceImageId) : null;
      const innerX = p.x + pad;
      const innerY = p.y + pad;
      const innerW = p.innerW;
      const innerH = p.innerH;
      const angleDeg = Number((p.angleDeg ?? (p.rotated ? 90 : 0)).toFixed(2));

      return {
        id: p.ripperId,
        name: p.name,
        category: ripper?.category || 'Other',
        x: innerX,
        y: innerY,
        width: innerW,
        height: innerH,
        paddedBox: { x: p.x, y: p.y, width: p.packedW, height: p.packedH },
        rotated: !!p.rotated || Math.abs(angleDeg) > 0.01,
        angleDeg,
        padding: pad,
        uv: {
          u0: Number((innerX / atlasW).toFixed(6)),
          v0: Number((innerY / atlasH).toFixed(6)),
          u1: Number(((innerX + p.packedW - pad * 2) / atlasW).toFixed(6)),
          v1: Number(((innerY + p.packedH - pad * 2) / atlasH).toFixed(6)),
        },
        sourceImage: srcImg
          ? {
              name: srcImg.name,
              width: srcImg.width,
              height: srcImg.height,
            }
          : null,
      };
    }),
  };
}
