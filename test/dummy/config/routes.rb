Rails.application.routes.draw do
  root "widgets#index"
  resources :widgets, only: [:index, :show] do
    post :close, on: :member
  end
end
