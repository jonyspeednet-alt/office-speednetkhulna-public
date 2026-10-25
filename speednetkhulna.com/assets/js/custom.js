/*
| ----------------------------------------------------------------------------------
| TABLE OF CONTENT
| ----------------------------------------------------------------------------------
-SETTING
-Preloader
-Scroll Animation
-Parallax(Stellar)
-Animated Entrances
-Chars Start
-Loader blocks
-Accordion
-Tooltip
-Zoom Images
-Isotope filter
-Select customization
-Main slider
-OWL Sliders
-Image animation
*/



$(document).ready(function() {

    "use strict";



     /////////////////////////////////////////////////////////////////
    // LOADER
    /////////////////////////////////////////////////////////////////





    var $preloader = $('#page-preloader'),
    $spinner = $preloader.find('.spinner-loader');
    $spinner.fadeOut();
    $preloader.delay(50).fadeOut('slow');




    function screenerGo(){


        $('.screen-loader').removeClass("screen-end");
        $('.screen-loader').addClass("screen-start");


    }

    setTimeout(screenerGo, 1500);


     function loadingHide(){


          $('div.loading').addClass("loading-hide");

    }

    setTimeout(loadingHide, 2300);




/////////////////////////////////////
//  Scroll Animation
/////////////////////////////////////


if ($('.scrollreveal').length > 0) {
    window.sr = ScrollReveal({
        reset:true,
        duration: 1000,
        delay: 200
    });

    sr.reveal('.scrollreveal');
  }




/**
 * Portfolio sticky menu
 */




   $(".sticky-bar").stick_in_parent();






//////////////////////////////
// Parallax(Stellar)
//////////////////////////////

if ($('.stellar').length > 0) {
    $.stellar({
        responsive: true
    });
}


/////////////////////////////////////
//  Chars Start
/////////////////////////////////////


if ($('body').length) {
    $(window).on('scroll', function() {
        var winH = $(window).scrollTop();

        $('.b-progress-list').waypoint(function() {
            $('.js-chart').each(function() {
                CharsStart();
            });
        }, {
            offset: '80%'
        });
    });
}


function CharsStart() {

    $('.js-chart').easyPieChart({
        barColor: false,
        trackColor: false,
        scaleColor: false,
        scaleLength: false,
        lineCap: false,
        lineWidth: false,
        size: false,
        animate: 5000,

        onStep: function(from, to, percent) {
            $(this.el).find('.js-percent').text(Math.round(percent));
        }
    });
}




/////////////////////////////////////
//  Loader blocks
/////////////////////////////////////


    $( ".js-scroll-next" ).on( "click", function() {

        var hiddenContent =  $( ".js-scroll-next + .js-scroll-content") ;

        $(".js-scroll-next").hide() ;
        hiddenContent.show() ;
        hiddenContent.addClass("animated");
        hiddenContent.addClass("animation-done");
        hiddenContent.addClass("bounceInUp");

    });



/////////////////////////////////////////////////////////////////
// Accordion
/////////////////////////////////////////////////////////////////

    $(".btn-collapse").on('click', function () {
            $(this).parents('.panel-group').children('.panel').removeClass('panel-default');
            $(this).parents('.panel').addClass('panel-default');
            if ($(this).is(".collapsed")) {
                $('.panel-title').removeClass('panel-passive');
            }
            else {$(this).next().toggleClass('panel-passive');
        };
    });




/////////////////////////////////////
//  Tooltip
/////////////////////////////////////


    $('.link-tooltip-1').tooltip({
    template: '<div class="tooltip tooltip-1" role="tooltip"><div class="tooltip-arrow"></div><div class="tooltip-inner"></div></div>',
  });
    $('.link-tooltip-2').tooltip({
    template: '<div class="tooltip tooltip-2" role="tooltip"><div class="tooltip-arrow"></div><div class="tooltip-inner"></div></div>',
  });





/////////////////////////////////////
//  Zoom Images
/////////////////////////////////////



  if ($('.js-zoom-gallery').length > 0) {
      $('.js-zoom-gallery').each(function() { // the containers for all your galleries
          $(this).magnificPopup({
              delegate: '.js-zoom-gallery__item', // the selector for gallery item
              type: 'image',
              gallery: {
                enabled:true
              },
        mainClass: 'mfp-with-zoom', // this class is for CSS animation below

        zoom: {
          enabled: true, // By default it's false, so don't forget to enable it

          duration: 300, // duration of the effect, in milliseconds
          easing: 'ease-in-out', // CSS transition easing function

          // The "opener" function should return the element from which popup will be zoomed in
          // and to which popup will be scaled down
          // By defailt it looks for an image tag:
          opener: function(openerElement) {
            // openerElement is the element on which popup was initialized, in this case its <a> tag
            // you don't need to add "opener" option if this code matches your needs, it's defailt one.
            return openerElement.is('img') ? openerElement : openerElement.find('img');
          }
        }
          });
      });
    }


  if ($('.js-zoom-images img-hover-effect img-hover-effect ').length > 0) {
      $('.js-zoom-images img-hover-effect img-hover-effect ').magnificPopup({
        type: 'image',
        mainClass: 'mfp-with-zoom', // this class is for CSS animation below

        zoom: {
          enabled: true, // By default it's false, so don't forget to enable it

          duration: 300, // duration of the effect, in milliseconds
          easing: 'ease-in-out', // CSS transition easing function

          // The "opener" function should return the element from which popup will be zoomed in
          // and to which popup will be scaled down
          // By defailt it looks for an image tag:
          opener: function(openerElement) {
            // openerElement is the element on which popup was initialized, in this case its <a> tag
            // you don't need to add "opener" option if this code matches your needs, it's defailt one.
            return openerElement.is('img') ? openerElement : openerElement.find('img');
          }
        }
      });

    }



  if ($('.popup-youtube').length > 0) {
    $('.popup-youtube').magnificPopup({
        disableOn: 700,
        type: 'iframe',
        mainClass: 'mfp-fade',
        removalDelay: 160,
        preloader: false,

        fixedContentPos: false
      });
  }


////////////////////////////////////////////
// ISOTOPE FILTER
///////////////////////////////////////////


  if ($('.b-isotope').length > 0) {

    var $container = $('.b-isotope-grid');

    // init Isotope
    var $grid = $('.grid').isotope({
      itemSelector: '.grid-item',
      percentPosition: true,
      masonry: {
        columnWidth: '.grid-sizer'
      }
    });
    // layout Isotope after each image loads
    $grid.imagesLoaded().progress( function() {
      $grid.isotope('layout');
    });

    // filter items when filter link is clicked
    $('.b-isotope-filter a').on( 'click', function() {
        var selector = $(this).attr('data-filter');
        $container.isotope({
            filter: selector
        });
        return false;
    });

    $('.b-isotope-filter a').on( 'click', function() {
      $('.b-isotope-filter').find('.current').removeClass('current');
      $( this ).parent().addClass('current');
    });
  }




/////////////////////////////////////
// Select customization
/////////////////////////////////////

if ($('.selectpicker').length > 0) {

  $('.selectpicker').selectpicker({
    style: 'ui-select'
  });
}



////////////////////////////////////////////
// Main slider
///////////////////////////////////////////


    if ($('#main-slider').length > 0) {

        var sliderWidth = $("#main-slider").data("slider-width");
        var sliderHeigth = $("#main-slider").data("slider-height");
        var sliderArrows = $("#main-slider").data("slider-arrows");
        var sliderButtons = $("#main-slider").data("slider-buttons");

        $( '#main-slider' ).sliderPro({
            width:  sliderWidth,
            height: sliderHeigth,
            arrows: sliderArrows,
            buttons: sliderButtons,
            fade: true,
            fullScreen: true,
            touchSwipe: false,
            autoplay: true,
            waitForLayers: true
        });
    }

  /* Typed cursor */


    $(".typed-strings").typed({
            stringsElement: $('.typed-strings ul'),
            typeSpeed: 30,
            backDelay: 500,
            loop: false,
            contentType: 'html', // or text
            // defaults to false for infinite loop
            loopCount: false,
            resetCallback: function() { newTyped(); }
        });


        $(".typed-strings2").typed({
            stringsElement: $('.typed-strings2 ul'),
            typeSpeed: 30,
            backDelay: 500,
            loop: false,
            contentType: 'html', // or text
            // defaults to false for infinite loop
            loopCount: true,
            resetCallback: function() { newTyped(); }
        });




/////////////////////////////////////
//  RevealFX Start
/////////////////////////////////////





$('#revealfx1').waypoint(function() {



var rev1 = new RevealFx

    (


        document.querySelector('#revealfx1'), {
          revealSettings : {
            bgcolor: '#e0e242',
            onCover: function(contentEl, revealerEl) {
              contentEl.style.opacity = 1;
            }
          }

}

    );

       rev1.reveal();


        }  , {
            triggerOnce: true,
            offset: '95%'
        });





$('#revealfx2').waypoint(function() {



var rev1 = new RevealFx

    (


        document.querySelector('#revealfx2'), {
          revealSettings : {
            bgcolor: '#e0e242',
            onCover: function(contentEl, revealerEl) {
              contentEl.style.opacity = 1;
            }
          }

}

    );

       rev1.reveal();


        }  , {
            triggerOnce: true,
            offset: '95%'
        });



$('#revealfx3').waypoint(function() {



var rev1 = new RevealFx

    (


        document.querySelector('#revealfx3'), {
          revealSettings : {
            bgcolor: '#e0e242',
            onCover: function(contentEl, revealerEl) {
              contentEl.style.opacity = 1;
            }
          }

}

    );

       rev1.reveal();


        }  , {
            triggerOnce: true,
            offset: '95%'
        });



$('#revealfx4').waypoint(function() {



var rev1 = new RevealFx

    (


        document.querySelector('#revealfx4'), {
          revealSettings : {
            bgcolor: '#e0e242',
            onCover: function(contentEl, revealerEl) {
              contentEl.style.opacity = 1;
            }
          }

}

    );

       rev1.reveal();


        }  , {
            triggerOnce: true,
            offset: '95%'
        });








$('#revealfx5').waypoint(function() {



var rev1 = new RevealFx

    (


        document.querySelector('#revealfx5'), {
          revealSettings : {
            bgcolor: '#e0e242',
            onCover: function(contentEl, revealerEl) {
              contentEl.style.opacity = 1;
            }
          }

}

    );

       rev1.reveal();


        }  , {
            triggerOnce: true,
            offset: '95%'
        });






$('#revealfx6').waypoint(function() {



var rev1 = new RevealFx

    (


        document.querySelector('#revealfx6'), {
          revealSettings : {
            bgcolor: '#e0e242',
            onCover: function(contentEl, revealerEl) {
              contentEl.style.opacity = 1;
            }
          }

}

    );

       rev1.reveal();


        }  , {
            triggerOnce: true,
            offset: '95%'
        });







$('#revealfx7').waypoint(function() {



var rev1 = new RevealFx

    (


        document.querySelector('#revealfx7'), {
          revealSettings : {
            bgcolor: '#e0e242',
            onCover: function(contentEl, revealerEl) {
              contentEl.style.opacity = 1;
            }
          }

}

    );

       rev1.reveal();


        }  , {
            triggerOnce: true,
            offset: '95%'
        });





$('#revealfx8').waypoint(function() {



var rev1 = new RevealFx

    (


        document.querySelector('#revealfx8'), {
          revealSettings : {
            bgcolor: '#e0e242',
            onCover: function(contentEl, revealerEl) {
              contentEl.style.opacity = 1;
            }
          }

}

    );

       rev1.reveal();


        }  , {
            triggerOnce: true,
            offset: '95%'
        });


$('#revealfx8').waypoint(function() {



var rev1 = new RevealFx

    (


        document.querySelector('#revealfx8'), {
          revealSettings : {
            bgcolor: '#e0e242',
            onCover: function(contentEl, revealerEl) {
              contentEl.style.opacity = 1;
            }
          }

}

    );

       rev1.reveal();


        }  , {
            triggerOnce: true,
            offset: '95%'
        });


/////////////////////////////////////
//  Effect Active
/////////////////////////////////////






$('.effect-active').waypoint(function() {


       $(this).addClass("active");


        }  , {
            triggerOnce: true,
            offset: '55%'
        });

$('.effect-active').on( "hover", function() {
   $(this).removeClass("active");
});










/////////////////////////////////////////////////////////////////
// OWL Sliders
/////////////////////////////////////////////////////////////////

    var Core = {

        initialized: false,

        initialize: function() {

                if (this.initialized) return;
                this.initialized = true;

                this.build();

        },

        build: function() {

        // Owl Carousel

            this.initOwlCarousel();
        },
        initOwlCarousel: function(options) {

            $(".enable-owl-carousel").each(function(i) {
                var $owl = $(this);

                var itemsData = $owl.data('items');
                var navigationData = $owl.data('navigation');
                var paginationData = $owl.data('pagination');
                var singleItemData = $owl.data('single-item');
                var autoPlayData = $owl.data('auto-play');
                var transitionStyleData = $owl.data('transition-style');
                var mainSliderData = $owl.data('main-text-animation');
                var afterInitDelay = $owl.data('after-init-delay');
                var stopOnHoverData = $owl.data('stop-on-hover');
                var min480 = $owl.data('min480');
                var min768 = $owl.data('min768');
                var min992 = $owl.data('min992');
                var min1200 = $owl.data('min1200');

                $owl.owlCarousel({
                    navigation : navigationData,
                    pagination: paginationData,
                    singleItem : singleItemData,
                    autoPlay : autoPlayData,
                    transitionStyle : transitionStyleData,
                    stopOnHover: stopOnHoverData,
                    navigationText : ["<i></i>","<i></i>"],
                    items: itemsData,
                    itemsCustom:[
                                    [0, 1],
                                    [465, min480],
                                    [750, min768],
                                    [975, min992],
                                    [1185, min1200]
                    ],
                    afterInit: function(elem){
                                if(mainSliderData){
                                        setTimeout(function(){
                                                $('.main-slider_zoomIn').css('visibility','visible').removeClass('zoomIn').addClass('zoomIn');
                                                $('.main-slider_fadeInLeft').css('visibility','visible').removeClass('fadeInLeft').addClass('fadeInLeft');
                                                $('.main-slider_fadeInLeftBig').css('visibility','visible').removeClass('fadeInLeftBig').addClass('fadeInLeftBig');
                                                $('.main-slider_fadeInRightBig').css('visibility','visible').removeClass('fadeInRightBig').addClass('fadeInRightBig');
                                        }, afterInitDelay);
                                    }
                    },
                    beforeMove: function(elem){
                        if(mainSliderData){
                                $('.main-slider_zoomIn').css('visibility','hidden').removeClass('zoomIn');
                                $('.main-slider_slideInUp').css('visibility','hidden').removeClass('slideInUp');
                                $('.main-slider_fadeInLeft').css('visibility','hidden').removeClass('fadeInLeft');
                                $('.main-slider_fadeInRight').css('visibility','hidden').removeClass('fadeInRight');
                                $('.main-slider_fadeInLeftBig').css('visibility','hidden').removeClass('fadeInLeftBig');
                                $('.main-slider_fadeInRightBig').css('visibility','hidden').removeClass('fadeInRightBig');
                        }
                    },
                    afterMove: sliderContentAnimate,
                    afterUpdate: sliderContentAnimate,
                });
            });

            function sliderContentAnimate(elem){
                var $elem = elem;
                var afterMoveDelay = $elem.data('after-move-delay');
                var mainSliderData = $elem.data('main-text-animation');
                if(mainSliderData){
                    setTimeout(function(){
                        $('.main-slider_zoomIn').css('visibility','visible').addClass('zoomIn');
                        $('.main-slider_slideInUp').css('visibility','visible').addClass('slideInUp');
                        $('.main-slider_fadeInLeft').css('visibility','visible').addClass('fadeInLeft');
                        $('.main-slider_fadeInRight').css('visibility','visible').addClass('fadeInRight');
                        $('.main-slider_fadeInLeftBig').css('visibility','visible').addClass('fadeInLeftBig');
                        $('.main-slider_fadeInRightBig').css('visibility','visible').addClass('fadeInRightBig');
                    }, afterMoveDelay);
                }
            }
        },

    };

    Core.initialize();


});



////////////////////////////////////////////
//  Loader
///////////////////////////////////////////

(function() {

  // Preload all images.
  imagesLoaded(document.querySelector('body'), function() {
    document.body.classList.remove('loading');
  });

})();

  new WOW().init();


////////////////////////////////////////////
//  On click scroll to section
///////////////////////////////////////////
// handle links with @href started with '#' only
$(document).on('click', 'a[href^="#"]', function(e) {
    // target element id
    var id = $(this).attr('href');

    // target element
    var $id = $(id);
    if ($id.length === 0) {
        return;
    }

    // prevent standard hash navigation (avoid blinking in IE)
    e.preventDefault();

    // top position relative to the document
    var pos = $id.offset().top;

    // animated top scrolling
    $('body, html').animate({scrollTop: pos});
});


/////////////////////////////////////////////////////////////////
// Map
/////////////////////////////////////////////////////////////////


// When the window has finished loading create our google map below
google.maps.event.addDomListener(window, 'load', init);

function init() {
    // Basic options for a simple Google Map
    // For more options see: https://developers.google.com/maps/documentation/javascript/reference#MapOptions
    var mapOptions = {
        // How zoomed in you want the map to start at (always required)
        zoom: 17,

        // The latitude and longitude to center the map (always required)
        center: new google.maps.LatLng(22.8085514,89.5757519), // New York

        scrollwheel: false,


        // How you would like to style the map.
        // This is where you would paste any style found on Snazzy Maps.
        styles: [{"featureType":"water","elementType":"geometry","stylers":[{"color":"#e9e9e9"},{"lightness":17}]},{"featureType":"landscape","elementType":"geometry","stylers":[{"color":"#f5f5f5"},{"lightness":20}]},{"featureType":"road.highway","elementType":"geometry.fill","stylers":[{"color":"#ffffff"},{"lightness":17}]},{"featureType":"road.highway","elementType":"geometry.stroke","stylers":[{"color":"#ffffff"},{"lightness":29},{"weight":0.2}]},{"featureType":"road.arterial","elementType":"geometry","stylers":[{"color":"#ffffff"},{"lightness":18}]},{"featureType":"road.local","elementType":"geometry","stylers":[{"color":"#ffffff"},{"lightness":16}]},{"featureType":"poi","elementType":"geometry","stylers":[{"color":"#f5f5f5"},{"lightness":21}]},{"featureType":"poi.park","elementType":"geometry","stylers":[{"color":"#dedede"},{"lightness":21}]},{"elementType":"labels.text.stroke","stylers":[{"visibility":"on"},{"color":"#ffffff"},{"lightness":16}]},{"elementType":"labels.text.fill","stylers":[{"saturation":36},{"color":"#333333"},{"lightness":40}]},{"elementType":"labels.icon","stylers":[{"visibility":"off"}]},{"featureType":"transit","elementType":"geometry","stylers":[{"color":"#f2f2f2"},{"lightness":19}]},{"featureType":"administrative","elementType":"geometry.fill","stylers":[{"color":"#fefefe"},{"lightness":20}]},{"featureType":"administrative","elementType":"geometry.stroke","stylers":[{"color":"#fefefe"},{"lightness":17},{"weight":1.2}]}]
    };

    // Get the HTML DOM element that will contain your map
    // We are using a div with id="map" seen below in the <body>
    var mapElement = document.getElementById('map');

    // Create the Google Map using our element and options defined above
    var map = new google.maps.Map(mapElement, mapOptions);

    var image = 'assets/img/map-marker.png';
    // Let's also add a marker while we're at it
    var marker = new google.maps.Marker({
        position: new google.maps.LatLng(22.8085514,89.5757519),
        map: map,
        icon: image,
        draggable: true,
        animation: google.maps.Animation.DROP
    });
    marker.addListener('click', toggleBounce);

    function toggleBounce() {
      if (marker.getAnimation() !== null) {
        marker.setAnimation(null);
      } else {
        marker.setAnimation(google.maps.Animation.BOUNCE);
      }
    }
}
