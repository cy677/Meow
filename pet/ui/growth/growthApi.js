export function createGrowthApi(request,{parent=false}={}) {
  const endpoint=parent?'/api/parent/growth':'/api/growth';
  return {
    read:(days=7)=>request(`${endpoint}?days=${encodeURIComponent(days)}`),
    summary:(days=7)=>request(`${endpoint}/summary?days=${encodeURIComponent(days)}`),
  };
}
