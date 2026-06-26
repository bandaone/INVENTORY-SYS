import { redirect } from 'next/navigation';

export default function StocktakeUiRedirect() {
  redirect('/operations/stocktake');
}
