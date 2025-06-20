/*
* Licensed to the Apache Software Foundation (ASF) under one
* or more contributor license agreements.  See the NOTICE file
* distributed with this work for additional information
* regarding copyright ownership.  The ASF licenses this file
* to you under the Apache License, Version 2.0 (the
* "License"); you may not use this file except in compliance
* with the License.  You may obtain a copy of the License at
*
*   http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing,
* software distributed under the License is distributed on an
* "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
* KIND, either express or implied.  See the License for the
* specific language governing permissions and limitations
* under the License.
*/

import * as zrUtil from 'zrender/src/core/util';
import * as graphic from '../../util/graphic';
import AxisBuilder, {AxisBuilderCfg} from './AxisBuilder';
import AxisView from './AxisView';
import * as cartesianAxisHelper from '../../coord/cartesian/cartesianAxisHelper';
import {rectCoordAxisBuildSplitArea, rectCoordAxisHandleRemove} from './axisSplitHelper';
import GlobalModel from '../../model/Global';
import ExtensionAPI from '../../core/ExtensionAPI';
import CartesianAxisModel from '../../coord/cartesian/AxisModel';
import GridModel from '../../coord/cartesian/GridModel';
import { Payload } from '../../util/types';
import { isIntervalOrLogScale } from '../../scale/helper';
import { getAxisBreakHelper } from './axisBreakHelper';
import { addEditorInfo } from '../../util/editorInfo';

const axisBuilderAttrs = [
    'axisLine', 'axisTickLabel', 'axisName'
] as const;
const selfBuilderAttrs = [
    'splitArea', 'splitLine', 'minorSplitLine', 'breakArea'
] as const;

class CartesianAxisView extends AxisView {

    static type = 'cartesianAxis';
    type = CartesianAxisView.type;

    axisPointerClass = 'CartesianAxisPointer';

    private _axisGroup: graphic.Group;

    /**
     * @override
     */
    render(axisModel: CartesianAxisModel, ecModel: GlobalModel, api: ExtensionAPI, payload: Payload) {

        this.group.removeAll();

        const oldAxisGroup = this._axisGroup;
        this._axisGroup = new graphic.Group();

        this.group.add(this._axisGroup);

        if (!axisModel.get('show')) {
            return;
        }

        const gridModel = axisModel.getCoordSysModel();

        const layout = cartesianAxisHelper.layout(gridModel, axisModel);

        const axisBuilder = new AxisBuilder(axisModel, api, zrUtil.extend({
            handleAutoShown(elementType) {
                const cartesians = gridModel.coordinateSystem.getCartesians();
                for (let i = 0; i < cartesians.length; i++) {
                    if (isIntervalOrLogScale(cartesians[i].getOtherAxis(axisModel.axis).scale)) {
                        if (elementType === 'axisTick' && axisModel.axis.type === 'category'
                            && axisModel.axis.onBand
                        ) {
                            return false;
                        }
                        // Still show axis tick or axisLine if other axis is value / log
                        return true;
                    }
                }
                // Not show axisTick or axisLine if other axis is category / time
                return false;
            }
        } as AxisBuilderCfg, layout));

        zrUtil.each(axisBuilderAttrs, axisBuilder.add, axisBuilder);

        this._axisGroup.add(axisBuilder.getGroup());

        zrUtil.each(selfBuilderAttrs, function (name) {
            if (axisModel.get([name, 'show'])) {
                axisElementBuilders[name](this, this._axisGroup, axisModel, gridModel, api);
            }
        }, this);

        // THIS is a special case for bar racing chart.
        // Update the axis label from the natural initial layout to
        // sorted layout should has no animation.
        const isInitialSortFromBarRacing = payload && payload.type === 'changeAxisOrder' && payload.isInitSort;

        if (!isInitialSortFromBarRacing) {
            graphic.groupTransition(oldAxisGroup, this._axisGroup, axisModel);
        }

        super.render(axisModel, ecModel, api, payload);
    }

    remove() {
        rectCoordAxisHandleRemove(this);
    }
}

interface AxisElementBuilder {
    (
        axisView: CartesianAxisView,
        axisGroup: graphic.Group,
        axisModel: CartesianAxisModel,
        gridModel: GridModel,
        api: ExtensionAPI
    ): void
}

const axisElementBuilders: Record<typeof selfBuilderAttrs[number], AxisElementBuilder> = {

    splitLine(axisView, axisGroup, axisModel, gridModel, api) {
        const axis = axisModel.axis;

        if (axis.scale.isBlank()) {
            return;
        }

        const splitLineModel = axisModel.getModel('splitLine');
        const lineStyleModel = splitLineModel.getModel('lineStyle');
        let lineColors = lineStyleModel.get('color');
        const showMinLine = splitLineModel.get('showMinLine') !== false;
        const showMaxLine = splitLineModel.get('showMaxLine') !== false;

        lineColors = zrUtil.isArray(lineColors) ? lineColors : [lineColors];

        const gridRect = gridModel.coordinateSystem.getRect();
        const isHorizontal = axis.isHorizontal();

        let lineCount = 0;

        const ticksCoords = axis.getTicksCoords({
            tickModel: splitLineModel,
            breakTicks: 'none',
            pruneByBreak: 'preserve_extent_bound',
        });

        const p1 = [];
        const p2 = [];

        const lineStyle = lineStyleModel.getLineStyle();
        for (let i = 0; i < ticksCoords.length; i++) {
            const tickCoord = axis.toGlobalCoord(ticksCoords[i].coord);

            if ((i === 0 && !showMinLine) || (i === ticksCoords.length - 1 && !showMaxLine)) {
                continue;
            }

            const tickValue = ticksCoords[i].tickValue;

            if (isHorizontal) {
                p1[0] = tickCoord;
                p1[1] = gridRect.y;
                p2[0] = tickCoord;
                p2[1] = gridRect.y + gridRect.height;
            }
            else {
                p1[0] = gridRect.x;
                p1[1] = tickCoord;
                p2[0] = gridRect.x + gridRect.width;
                p2[1] = tickCoord;
            }

            const colorIndex = (lineCount++) % lineColors.length;
            const line = new graphic.Line({
                anid: tickValue != null ? 'line_' + tickValue : null,
                autoBatch: true,
                shape: {
                    x1: p1[0],
                    y1: p1[1],
                    x2: p2[0],
                    y2: p2[1]
                },
                style: zrUtil.defaults({
                    stroke: lineColors[colorIndex]
                }, lineStyle),
                silent: true
            });
            if (__EDITOR__) {
                addEditorInfo(line, {
                    component: axisModel.mainType,
                    componentIndex: axisModel.componentIndex,
                    subType: axisModel.subType,
                    element: 'splitLine'
                });
            }
            graphic.subPixelOptimizeLine(line.shape, lineStyle.lineWidth);
            axisGroup.add(line);
        }
    },

    minorSplitLine(axisView, axisGroup, axisModel, gridModel, api) {
        const axis = axisModel.axis;

        const minorSplitLineModel = axisModel.getModel('minorSplitLine');
        const lineStyleModel = minorSplitLineModel.getModel('lineStyle');

        const gridRect = gridModel.coordinateSystem.getRect();
        const isHorizontal = axis.isHorizontal();

        const minorTicksCoords = axis.getMinorTicksCoords();
        if (!minorTicksCoords.length) {
            return;
        }
        const p1 = [];
        const p2 = [];

        const lineStyle = lineStyleModel.getLineStyle();

        for (let i = 0; i < minorTicksCoords.length; i++) {
            for (let k = 0; k < minorTicksCoords[i].length; k++) {
                const tickCoord = axis.toGlobalCoord(minorTicksCoords[i][k].coord);

                if (isHorizontal) {
                    p1[0] = tickCoord;
                    p1[1] = gridRect.y;
                    p2[0] = tickCoord;
                    p2[1] = gridRect.y + gridRect.height;
                }
                else {
                    p1[0] = gridRect.x;
                    p1[1] = tickCoord;
                    p2[0] = gridRect.x + gridRect.width;
                    p2[1] = tickCoord;
                }

                const line = new graphic.Line({
                    anid: 'minor_line_' + minorTicksCoords[i][k].tickValue,
                    autoBatch: true,
                    shape: {
                        x1: p1[0],
                        y1: p1[1],
                        x2: p2[0],
                        y2: p2[1]
                    },
                    style: lineStyle,
                    silent: true
                });
                if (__EDITOR__) {
                    addEditorInfo(line, {
                        component: axisModel.mainType,
                        componentIndex: axisModel.componentIndex,
                        subType: axisModel.subType,
                        element: 'minorSplitLine'
                    });
                }
                graphic.subPixelOptimizeLine(line.shape, lineStyle.lineWidth);
                axisGroup.add(line);
            }
        }
    },

    splitArea(axisView, axisGroup, axisModel, gridModel, api) {
        rectCoordAxisBuildSplitArea(axisView, axisGroup, axisModel, gridModel);
    },

    breakArea(axisView, axisGroup, axisModel, gridModel, api) {
        const axisBreakHelper = getAxisBreakHelper();
        const scale = axisModel.axis.scale;
        if (axisBreakHelper && scale.type !== 'ordinal') {
            axisBreakHelper.rectCoordBuildBreakAxis(
                axisGroup, axisView, axisModel, gridModel.coordinateSystem.getRect(), api
            );
        }
    }
};

export class CartesianXAxisView extends CartesianAxisView {
    static type = 'xAxis';
    type = CartesianXAxisView.type;
}
export class CartesianYAxisView extends CartesianAxisView {
    static type = 'yAxis';
    type = CartesianXAxisView.type;
}

export default CartesianAxisView;
