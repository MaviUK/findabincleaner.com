// Make sure tsconfig includes "src/**/*.d.ts"
import 'react-leaflet';

declare module 'react-leaflet' {
  // v4 does have these at runtime; some setups miss them in types
  export interface MapContainerProps {
    center?: import('leaflet').LatLngExpression;
    zoom?: number;
    style?: React.CSSProperties;
  }

  export interface TileLayerProps {
    url: string;
    attribution?: string;
  }
}
