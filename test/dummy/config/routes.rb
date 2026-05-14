Rails.application.routes.draw do
  root "widgets#index"
  resources :widgets, only: [:index, :show, :new, :create, :destroy] do
    post :close, on: :member
    post :preview, on: :member
    collection do
      get  :bump_form
      post :bump
    end
  end
end
