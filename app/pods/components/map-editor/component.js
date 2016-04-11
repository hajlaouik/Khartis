import Ember from 'ember';
import d3 from 'd3';
import projector from 'mapp/utils/projector';
import d3lper from 'mapp/utils/d3lper';
import GraphLayout from 'mapp/models/graph-layout';
import {geoMatch} from 'mapp/utils/geo-match';
import MaskPattern from 'mapp/utils/mask-pattern';
/* global Em */

export default Ember.Component.extend({
  
  tagName: "svg",
  attributeBindings: ['width', 'xmlns', 'xmlns:xlink', 'version'],
  width: "100%",
  xmlns: 'http://www.w3.org/2000/svg',
  'xmlns:xlink': "http://www.w3.org/1999/xlink",
  version: '1.1',
  
  $width: null,
  $height: null,
	
	base: null,
	
	data: null,
	
	graphLayout: null,
  
  graphLayers: [],
  
  resizeInterval: null,
  
  applicationController: null,
  
  windowLocation: function() {
    return window.location;
  }.property(),
  
  init() {
    this._super();
  },
  
	draw: function() {
    
		var d3g = this.d3l();
		
		// ========
		// = DEFS =
		// ========
		
		let defs = d3g.append("defs");
    
    defs.append("path")
      .datum({type: "Sphere"})
      .attr("id", "sphere");

    defs.append("clipPath")
      .attr("id", "clip")
      .append("use");
    
		// ---------
		
    // HANDLE RESIZE
    let $size = () => {
      this.setProperties({
        '$width': this.$().parent().width(),
        '$height': this.$().parent().height()
      });
    };
    this.set('resizeInterval', setInterval($size, 600));
    $size();
    // ---------
    
		d3g.append("rect")
			.classed("bg", true)
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("fill", this.get("graphLayout.backgroundColor"));
		
    let mapG = d3g.append("g")
      .classed("map", true);
    
    mapG.append("g")
			.classed("backmap", true);
    	
		mapG.append("g")
			.classed("layers", true);
    
    // DRAG & ZOOM
    
    var zoom = d3.behavior.zoom()
      .scaleExtent([1, 10])
      .on("zoom", () => {
        let rz =  Math.round(d3.event.scale * 4) / 4;
        if (rz != this.get('graphLayout.zoom')) {
          this.set('graphLayout.zoom',rz);
          this.sendAction('onAskVersioning', "freeze");
        }
      })
      .scale(this.get('graphLayout.zoom'));
      
    this.addObserver('graphLayout.zoom', () => zoom.scale(this.get('graphLayout.zoom')) );

    var drag = d3.behavior.drag()
      .origin(() => {
        return {x: mapG.attr('x'), y: mapG.attr('y')};
      })
      .on("dragstart", () => {
        d3.event.sourceEvent.stopPropagation();
        mapG.classed("dragging", true);
      })
      .on("drag", () => {
        let bbox = mapG.node().getBBox(),
            pos = {
              tx: Math.min(bbox.width, Math.max(d3.event.x, -bbox.width)),
              ty: Math.min(bbox.height, Math.max(d3.event.y, -bbox.height))
            };
        mapG.attr({
         'transform': d3lper.translate({tx: pos.tx, ty: pos.ty}), 
          x: pos.tx,
          y: pos.ty
        });
      })
      .on("dragend", () => {
        mapG.classed("dragging", false);
        this.get('graphLayout').setProperties({
          tx: mapG.attr('x'),
          ty: mapG.attr('y')
        });
        this.sendAction('onAskVersioning', "freeze");
      });
      
    d3g.call(drag);
    d3g.call(zoom);
    	
		let og = d3g.append("g")
			.classed("offset", true);
			
		og.append("line").classed("horizontal-top", true);
		og.append("line").classed("horizontal-bottom", true);
		og.append("line").classed("vertical-left", true);
		og.append("line").classed("vertical-right", true);
		
		let mg = d3g.append("g")
			.classed("margin", true);
			
		mg.append("rect")
			.attr("fill", "none");

		this.projectAndDraw();
    this.updatePosition();
		this.updateColors();
          
	}.on("didInsertElement"),
  
  cleanup: function() {
    clearInterval(this.get('resizeInterval'));
  }.on("willDestroyElement"),
	
	updateColors: function() {
		
		var d3g = this.d3l();
		
		d3g.selectAll("defs pattern g")
 			.style("stroke", this.get("graphLayout.virginPatternColor"));
		
		d3g.style("background-color", this.get("graphLayout.backgroundColor"));
			
		d3g.select("rect.bg")
			.attr("fill", this.get("graphLayout.backgroundColor"));
		
		d3g.selectAll("g.offset line")
			.attr("stroke", "#C0E2EF");
			
		d3g.selectAll("g.margin rect")
			.attr("stroke", "#20E2EF");
		
	}.observes('graphLayout.stroke', 'graphLayout.backgroundColor',
    'graphLayout.virginPatternColorAuto', 'graphLayout.virginPatternColor'),
	
	updateStroke: function() {
		
		var d3g = this.d3l();
		
		d3g.selectAll("path.feature")
			.attr("stroke-width", this.get("graphLayout.strokeWidth"));
		
	}.observes('graphLayout.strokeWidth'),
  
  updatePosition: function() {
    
    this.d3l().select(".map")
      .attr("x", this.get('graphLayout.tx'))
      .attr("y", this.get('graphLayout.ty'))
      .attr("transform", d3lper.translate({tx: this.get('graphLayout.tx'), ty: this.get('graphLayout.ty')}));
    
  }.observes('graphLayout.tx', 'graphLayout.ty'),
  
  projection: function() {
    
    var w = Math.max(this.get('$width'), this.get('graphLayout.width'));
		var h = Math.max(this.get('$height'), this.get('graphLayout.height'));
    
    return projector.computeProjection(
			this.get("graphLayout.autoCenter") ? this.get("filteredBase"):null,
			w,
			h,
			this.get('graphLayout.width'),
			this.get('graphLayout.height'),
			this.get('graphLayout.margin'),
      this.get('graphLayout.zoom'),
			this.get('graphLayout.projection')
		);
    
  }.property('$width', '$height', 'graphLayout.autoCenter', 'graphLayout.width',
    'graphLayout.height', 'graphLayout.zoom', 'graphLayout.margin',
    'graphLayout.projection._defferedChangeIndicator'),
  
	
	projectAndDraw: function() {
    
    var path = d3.geo.path();
		path.projection(this.get('projection'));
		
		// ===========
		// = VIEWBOX =
		// ===========
		
		var w = Math.max(this.get('$width'), this.get('graphLayout.width'));
		var h = Math.max(this.get('$height'), this.get('graphLayout.height'));
		
		this.d3l().attr("viewBox", "0 0 "+w+" "+h);
		// ===========
		
		this.d3l().selectAll("g.offset line.horizontal-top")
			.attr("x1", 0)
			.attr("y1", this.get('graphLayout').vOffset(h))
			.attr("x2", w)
			.attr("y2", this.get('graphLayout').vOffset(h))
		  .attr("stroke-width", "1");
    
		this.d3l().selectAll("g.offset line.horizontal-bottom")
			.attr("x1", 0)
			.attr("y1", h - this.get('graphLayout').vOffset(h))
			.attr("x2", w)
			.attr("y2", h - this.get('graphLayout').vOffset(h))
		  .attr("stroke-width", "1");
			
		this.d3l().selectAll("g.offset line.vertical-left")
			.attr("x1", w - this.get('graphLayout').hOffset(w))
			.attr("y1", 0)
			.attr("x2", w - this.get('graphLayout').hOffset(w))
			.attr("y2", h)
		  .attr("stroke-width", "1");
			
		this.d3l().selectAll("g.offset line.vertical-right")
			.attr("x1", this.get('graphLayout').hOffset(w))
			.attr("y1", 0)
			.attr("x2", this.get('graphLayout').hOffset(w))
			.attr("y2", h)
		  .attr("stroke-width", "1");
		
		this.d3l().select("g.margin")
			.attr("transform", "translate("+this.get('graphLayout').hOffset(w)
				+", "+this.get('graphLayout').vOffset(h)+")")
			.selectAll("rect")
			.attr("x", this.get('graphLayout.margin.l'))
			.attr("y", this.get('graphLayout.margin.t'))
			.attr("width", this.get('graphLayout.width') - this.get('graphLayout.margin.h'))
			.attr("height", this.get('graphLayout.height') - this.get('graphLayout.margin.v'))
      .attr("stroke-width", "1")
      .attr("stroke-linecap", "round")
      .attr("stroke-dasharray", "1, 3");
		
    let defs = this.d3l().select("defs");
    
    defs.select("#sphere")
      .datum({type: "Sphere"})
      .attr("d", path);

    defs.select("#clip use")
      .attr("xlink:href", `${window.location}#sphere`);
    
		let landSel = defs
			.selectAll("path.feature")
			.attr("d", path)
      .attr("clip-path", `url(${window.location}#clip)`)
      .data(this.get('base').lands.features);
      
    landSel.enter()
      .append("path")
			.attr("d", path)
      .attr("id", (d) => `f-path-${d.id}`)
      .attr("clip-path", `url(${window.location}#clip)`)
			.classed("feature", true);

		landSel.exit().remove();
    
    this.drawBackmap();
    this.drawLayers();
			
	}.observes('windowLocation', 'projection', 'graphLayout.virginDisplayed', 'graphLayout.width',
	 'graphLayout.height', 'graphLayout.margin.h',  'graphLayout.margin.v'),
   
   drawBackmap: function() {
     
    this.d3l().select("g.backmap").append("use")
      .attr("class", "stroke")
      .style("fill", "none")
      .style("stroke", "black")
      .attr("xlink:href", `${window.location}#sphere`);
    
    var uses = this.d3l().select("g.backmap")
      .selectAll("use.feature")
      .attr("xlink:xlink:href", d => `${window.location}#f-path-${d.id}`)
      .style("fill", this.get('graphLayout.backMapColor'))
      .data(this.get('base').lands.features);
      
    uses.enter().append("use")
      .attr("xlink:xlink:href", d => `${window.location}#f-path-${d.id}`)
			.attr("stroke-width", this.get("graphLayout.strokeWidth"))
			.attr("stroke", this.get("graphLayout.stroke"))
      .style("fill", this.get('graphLayout.backMapColor'))
			.classed("feature", true);
      
  }.observes('graphLayout.backMapColor'),
  
  drawLayers: function() {
    
    let self = this,
        data = this.get('graphLayers')
          .filter( gl => gl.get('visible') && gl.get('mapping') && gl.get('mapping.varCol') )
          .reverse();
    
    let sel = this.d3l().select("g.layers")
      .selectAll("g.layer")
      .data(data);
    
    sel.enter().append("g")
      .attr("stroke", this.get("graphLayout.stroke"))
      .classed("layer", true);
    
    sel.order().exit().remove();
    
    sel.each(function(d, index) {
      d.index = index;
      self.mapData(d3.select(this), d);
    });
    
  }.observes('graphLayers.[]', 'graphLayers.@each._defferedChangeIndicator'),
  
	mapData: function(d3Layer, graphLayer) {
    
    let geoCols = graphLayer.get('mapping.geoCols'),
        varCol = graphLayer.get('mapping.varCol'),
        data = [];
    
    if (geoCols.length === 1) {
      
      data = varCol.get('cells').map( (cell, index) => {
        
        let match = geoMatch(geoCols[0].get('cells').objectAt(index).postProcessedValue()),
            val = cell.postProcessedValue();
        if (!cell.get('row.header') && match && val != null) {
          return {
            id: match.value.iso_a2,
            value: val,
            cell: cell,
            index: index,
            surface: this.get('base').lands.features.find( f => f.id === match.value.iso_a2),
            point: this.get('base').centroids.features.find( f => f.id === match.value.iso_a2)
          };
        }
        
        return undefined;
        
      }).filter( d => d !== undefined );
      
      
      if (graphLayer.get('mapping.visualization.type') === "surface") {
        this.mapPath(d3Layer, data, graphLayer);
      } else if (graphLayer.get('mapping.visualization.type') === "symbol") {
        this.mapShape(d3Layer, data, graphLayer);
      }
      
    } else if (geoCols.length === 2 && geoCols[0] && geoCols[1]) {
      
      data = varCol.get('cells').map( (cell, index) => {
        
        let val = cell.postProcessedValue(),
            lon = geoCols[0].get('cells').objectAt(index).postProcessedValue(),
            lat = geoCols[1].get('cells').objectAt(index).postProcessedValue();
        
        if (!cell.get('row.header') 
          && val != null 
          && !Ember.isEmpty(lat) && !Ember.isEmpty(lon)) {
          return {
            id: `coord-${index}`,
            value: val,
            index: index,
            surface: null,
            point: {
              geometry: {
                coordinates: [
                  lon,
                  lat
                ]
              }
            }
          };
        }
        
        return undefined;
        
      }).filter( d => d !== undefined );
      
      this.mapShape(d3Layer, data, graphLayer);
      
    }
    
  },
  
  mapPath: function(d3Layer, data, graphLayer) {
    
    let mapping = graphLayer.get('mapping'),
        converter = mapping.fn();
		
    d3Layer.selectAll("*").remove();
      
    let uses = d3Layer.selectAll(".feature")
      .data(data);
    
    if (graphLayer.get('mapping.visualization.pattern') != null) {
      
      graphLayer.get('mapping.patternModifiers').forEach( pm => {
        this.d3l().call(pm.fn);
      });
      
    }

    let sel = uses.enter().append("use")
      .attr("xlink:xlink:href", d => `${window.location}#f-path-${d.id}`)
			.attr("stroke-width", this.get("graphLayout.strokeWidth"))
			.attr("stroke", this.get("graphLayout.stroke"))
			.classed("feature", true)
      .style({
        "fill": d => converter(d.cell, "fill"),
        "mask": d => `url(${converter(d.cell, "texture")})`
      });

		uses.exit().remove();
			
	},
  
   mapShape: function(d3Layer, data, graphLayer) {
		
    let projection = this.get('projection'),
        scale = d3.scale[graphLayer.scaleType()]();
		
		scale.domain(d3.extent(data, c => c.value));
    
    d3Layer.selectAll("*").remove();
    
    let centroidSel = d3Layer
			.selectAll(".feature")
			.attr("transform", d => d3lper.translate({
        tx: projection(d.point.geometry.coordinates)[0],
        ty: projection(d.point.geometry.coordinates)[1]
      }))
      .data(data);
      
    let g = centroidSel.enter()
      .append("g")
			.classed("feature", true)
      .attr("transform", d => d3lper.translate({
        tx: projection(d.point.geometry.coordinates)[0],
        ty: projection(d.point.geometry.coordinates)[1]
      }));
    
    let shape,
        sizeFn,
        colorFn;
        
    if (graphLayer.get('mapping.shape') === "point") {
      
      shape = g.append("circle")
        .attr("cx", 0)
        .attr("cy", 0);
        
      sizeFn = function(calc) {
        return function() {
          this.attr("r", d => calc(d.value));
        };
      };
      
      colorFn = function(calc) {
        return function() {
          this.attr("fill", d => calc(d.value));
        };
      };
      
    } else if (graphLayer.get('mapping.shape') === "rect") {
      
      shape = g.append("rect");
      sizeFn = function(calc) {
         return function() {
            let size = d => calc(d.value)*2,
                shift = d => -calc(d.value);
            this.attr({
              width: size,
              height: size,
              x: shift,
              y: shift
            });
         };
      };
      
      colorFn = function(calc) {
        return function() {
          this.attr("fill", d => calc(d.value));
        };
      };
      
    } else if (graphLayer.get('mapping.shape') === "text") {
      
      shape = g.append("text")
        .attr("x", 0)
        .attr("y", 0)
        .attr("text-anchor", "middle")
        .style("font-weight", "lighter")
        .text( (d) => graphLayer.get('mapping').labelAtIndex(d.index) );
        
      sizeFn = function(calc) {
         return function() {
            let size = d => calc(d.value);
            this.attr({
              "font-size": size
            });
         };
      };
      
      colorFn = function(calc) {
        return function() {
          this.attr({
            "fill": d => calc(d.value),
            "stroke": d => calc(d.value)
          });
        };
      };
      
    }
    
    if (graphLayer.get('mapping.scaleOf') === "size") {
      
      scale.range([graphLayer.get('mapping.size'), graphLayer.get('mapping.size')*2]);
      shape.call(colorFn( v => graphLayer.get('mapping.color') ))
           .call(sizeFn( v => v != null ? scale(v) : 0 ));
           
    } else if (graphLayer.get('mapping.scaleOf') === "fill") {
      
      scale.range([graphLayer.get('mapping.color'), "#f9aa0f"]);
      shape.call(colorFn( v => v != null ? scale(v): "none" ))
           .call(sizeFn( v => graphLayer.get('mapping.size') ));
           
    } else {
      shape.call(colorFn( v => graphLayer.get('mapping.color') ))
           .call(sizeFn( v => graphLayer.get('mapping.size') ));
    }

		centroidSel.exit().remove();
    
	}

	
});
